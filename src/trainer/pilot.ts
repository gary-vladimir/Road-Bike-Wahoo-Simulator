import {
  ControlQueue,
  encodeControl,
  type ControlLimits,
  type AuditEntry,
  type ControlWire,
} from './control';
import { PowerSupervisor, type PilotState } from '../safety/supervisor';
import type { Telemetry } from './ftms';
import { SimulationSupervisor } from '../safety/simulation';
import { diagnosticControlRange, roadControlRange } from '../ride/control-range';
export type PilotSnapshot = {
  state: PilotState;
  applied: number;
  requested: number;
  message: string;
  audit: AuditEntry[];
  machineStatus: { at: number; bytes: number[] }[];
  mode?: 'erg' | 'sim';
  grade?: number;
  requestedGrade?: number;
  setup?: { riderMass: number; tire: string; circumferenceMm: number };
};
type PilotDevice = {
  device: BluetoothDevice;
  range: { min: number; max: number; increment: number };
  telemetry: () => Telemetry;
};
async function acquireLock(): Promise<() => void> {
  if (!navigator.locks) throw new Error('Exclusive browser control locking is unavailable.');
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    void navigator.locks
      .request('bikesim-trainer-control', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error('Another BikeSIM tab owns trainer control.'));
          return;
        }
        resolve(release);
        await held;
      })
      .catch(reject);
  });
}
/** Explicitly armed diagnostics, SIM roads or ERG workouts. Pairing never arms it. */
export class ErgPilot {
  private timer?: ReturnType<typeof setInterval>;
  private target = 50;
  private disposed = false;
  private shutdown?: Promise<void>;
  private checking = false;
  private controlAttempted = false;
  private supervisor: PowerSupervisor | SimulationSupervisor;
  private readiness = { baselineConfirmed: false, trainerProfileConfirmed: false };
  private status: BluetoothRemoteGATTCharacteristic;
  private point: BluetoothRemoteGATTCharacteristic;
  private queue: ControlQueue;
  private limits: ControlLimits;
  private statuses: { at: number; bytes: number[] }[] = [];
  private snapshot(): PilotSnapshot {
    return {
      state: this.supervisor.state,
      applied: this.supervisor instanceof PowerSupervisor ? this.supervisor.applied : 0,
      requested: this.mode === 'erg' ? this.target : 0,
      mode: this.mode,
      grade: this.supervisor instanceof SimulationSupervisor ? this.supervisor.grade : undefined,
      requestedGrade: this.mode === 'sim' ? this.target : undefined,
      message: this.supervisor.message,
      audit: [...this.queue.audit],
      machineStatus: [...this.statuses],
    };
  }
  private emit() {
    this.changed(this.snapshot());
  }
  private visibility = () => {
    if (document.hidden) void this.trip('Control paused because the tab became hidden.');
  };
  private key = (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.code === 'Space') {
      e.preventDefault();
      void this.stop();
    }
  };
  private leaving = () => {
    void this.stop();
  };
  private disconnect = () => {
    this.queue.close();
    void this.trip('Bluetooth disconnected. Physical load state is unknown.');
  };
  private machineStatus = (e: Event) => {
    const data = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (data) {
      this.statuses.push({
        at: performance.now(),
        bytes: Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
      });
      if (this.statuses.length > 200) this.statuses.shift();
      this.emit();
    }
    if (
      data &&
      data.byteLength &&
      [0x01, 0x02, 0x03, 0xff].includes(data.getUint8(0)) &&
      ['arming', 'running'].includes(this.supervisor.state)
    )
      void this.trip('Trainer stopped, reset, or revoked control.');
  };
  private constructor(
    private source: PilotDevice,
    point: BluetoothRemoteGATTCharacteristic,
    status: BluetoothRemoteGATTCharacteristic,
    private release: () => void,
    private changed: (s: PilotSnapshot) => void,
    private mode: 'erg' | 'sim',
    private scope: 'diagnostic' | 'road' | 'workout',
    powerCeiling: number,
  ) {
    this.point = point;
    this.status = status;
    const wire: ControlWire = {
      write: (bytes) => {
        this.controlAttempted = true;
        return point.writeValueWithResponse(Uint8Array.from(bytes).buffer);
      },
      subscribe: (callback) => {
        const notify = (e: Event) => {
          const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (value) callback(value);
        };
        point.addEventListener('characteristicvaluechanged', notify);
        return () => point.removeEventListener('characteristicvaluechanged', notify);
      },
    };
    const limits: ControlLimits = (this.limits = {
      ...source.range,
      ceiling: scope === 'workout' ? powerCeiling : 100,
      ...(scope === 'workout' ? { powerMode: 'workout' as const } : {}),
      ...(mode === 'sim'
        ? { simulation: scope === 'road' ? roadControlRange : diagnosticControlRange }
        : {}),
    });
    this.queue = new ControlQueue(wire, limits);
    this.target = mode === 'sim' ? 0 : 50;
    this.supervisor =
      mode === 'sim'
        ? new SimulationSupervisor(this.queue, limits, source.telemetry)
        : new PowerSupervisor(this.queue, limits, source.telemetry);
  }
  static async prepare(
    source: PilotDevice,
    changed: (s: PilotSnapshot) => void,
    mode: 'erg' | 'sim' = 'erg',
    scope: 'diagnostic' | 'road' | 'workout' = 'diagnostic',
    powerCeiling = 100,
  ): Promise<ErgPilot> {
    if (scope === 'road' && mode !== 'sim') throw new Error('Road control requires SIM mode.');
    if (
      scope === 'workout' &&
      (mode !== 'erg' || !Number.isInteger(powerCeiling) || powerCeiling < 50 || powerCeiling > 600)
    )
      throw new Error('Workouts require ERG and an explicit 50–600 W ceiling.');
    if (import.meta.env.VITE_TRAINER_CONTROL !== 'pilot')
      throw new Error('Hardware control is disabled in this build.');
    if (document.hidden) throw new Error('Keep the trainer test tab visible.');
    const release = await acquireLock();
    let pilot: ErgPilot | undefined;
    try {
      if (!source.device.gatt?.connected)
        throw new Error('Pair the trainer before starting the pilot.');
      const service = await source.device.gatt.getPrimaryService(0x1826);
      const point = await service.getCharacteristic(0x2ad9),
        status = await service.getCharacteristic(0x2ada);
      if (!point.properties.write || !point.properties.indicate)
        throw new Error('The trainer must support acknowledged control writes and indications.');
      if (scope === 'workout') {
        // KICKR's advertised 1 W range must cover startup and the complete chosen workout.
        if (
          source.range.increment !== 1 ||
          source.range.min > 40 ||
          source.range.max < powerCeiling
        )
          throw new Error('Trainer power range cannot represent the complete workout.');
      }
      pilot = new ErgPilot(source, point, status, release, changed, mode, scope, powerCeiling);
      await point.startNotifications();
      status.addEventListener('characteristicvaluechanged', pilot.machineStatus);
      await status.startNotifications();
      source.device.addEventListener('gattserverdisconnected', pilot.disconnect);
      document.addEventListener('visibilitychange', pilot.visibility);
      window.addEventListener('keydown', pilot.key);
      window.addEventListener('beforeunload', pilot.leaving);
      return pilot;
    } catch (error) {
      if (pilot) pilot.dispose();
      else release();
      throw error;
    }
  }
  async start(readiness?: { baselineConfirmed: boolean; trainerProfileConfirmed: boolean }) {
    if (this.disposed || document.hidden) {
      await this.stop();
      return;
    }
    if (this.supervisor.state !== 'idle') return;
    if (
      (this.mode === 'sim' || this.scope === 'workout') &&
      (!readiness?.baselineConfirmed || !readiness.trainerProfileConfirmed)
    ) {
      await this.stop();
      throw new Error('Confirm the comfortable baseline and matching trainer profile first.');
    }
    if (readiness) this.readiness = { ...readiness };
    this.supervisor.state = 'waiting';
    this.supervisor.message =
      this.mode === 'sim'
        ? 'Waiting for fresh power. Zero watts and coasting are valid; no cadence minimum.'
        : 'Waiting for pedaling. Reach 50 rpm to begin; no resistance commands sent yet.';
    this.emit();
    this.timer = setInterval(() => {
      if (this.shutdown || this.disposed) return;
      if (this.supervisor.state === 'waiting') {
        void this.tryArm();
        return;
      }
      void this.supervisor
        .checkTelemetry()
        .then(async () => {
          if (this.checking || this.shutdown || this.disposed) return;
          this.checking = true;
          try {
            await this.supervisor.update(this.target);
            await this.supervisor.checkTelemetry();
          } finally {
            this.checking = false;
          }
          this.emit();
          if (this.supervisor.state === 'faulted') {
            await this.shutdown;
            this.dispose();
          }
        })
        .catch((error) => this.trip((error as Error).message));
    }, 250);
    await this.tryArm();
  }
  private async tryArm() {
    if (this.checking || this.disposed || this.shutdown || this.supervisor.state !== 'waiting')
      return;
    const reason = this.supervisor.preflight();
    if (reason) {
      this.supervisor.message = `Waiting for ${this.mode === 'sim' ? 'telemetry' : 'pedaling'}: ${reason}. No resistance commands sent yet.`;
      this.emit();
      return;
    }
    this.checking = true;
    try {
      const arming =
        this.supervisor instanceof SimulationSupervisor
          ? this.supervisor.arm(this.readiness)
          : this.supervisor.arm();
      this.emit();
      await arming;
      const state = this.snapshot().state;
      if (state === 'running')
        this.supervisor.message =
          this.scope === 'workout'
            ? 'ERG active. Keep a steady cadence; Stop ends control.'
            : 'Test running. Use Stop to end resistance control.';
      this.emit();
      if (state !== 'running') {
        await this.shutdown;
        this.dispose();
      }
    } catch (error) {
      await this.trip((error as Error).message);
    } finally {
      this.checking = false;
    }
  }
  setTarget(watts: number) {
    if (this.mode !== 'erg') throw new Error('Power targets are unavailable in SIM mode.');
    if (this.scope === 'workout') encodeControl({ kind: 'power', watts }, this.limits);
    else if (!Number.isInteger(watts) || watts < 50 || watts > 100)
      throw new Error('The supervised test is limited to 50–100 W.');
    if (this.disposed || this.shutdown || this.supervisor.state !== 'running') return;
    this.target = watts;
    this.emit();
  }
  setGrade(grade: number) {
    const range = this.scope === 'road' ? roadControlRange : diagnosticControlRange;
    if (
      this.mode !== 'sim' ||
      !Number.isFinite(grade) ||
      grade < range.minGrade ||
      grade > range.maxGrade
    )
      throw new Error(`SIM control is limited to ${range.minGrade}% through +${range.maxGrade}%.`);
    if (this.disposed || this.shutdown || this.supervisor.state !== 'running') return;
    this.target = grade;
    this.emit();
  }
  async trip(reason: string) {
    if (this.disposed || this.shutdown) return;
    this.shutdown = (async () => {
      clearInterval(this.timer);
      await this.supervisor.fault(reason);
      this.emit();
      this.dispose();
    })();
    return this.shutdown;
  }
  stop() {
    if (this.shutdown) return this.shutdown;
    if (this.disposed) return Promise.resolve();
    this.shutdown = (async () => {
      clearInterval(this.timer);
      const stopping = this.supervisor.stop();
      this.emit();
      await stopping;
      this.emit();
      this.dispose();
    })();
    return this.shutdown;
  }
  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('beforeunload', this.leaving);
    this.source.device.removeEventListener('gattserverdisconnected', this.disconnect);
    this.status.removeEventListener('characteristicvaluechanged', this.machineStatus);
    this.queue.close();
    // Keep telemetry after cancellation or an acknowledged stop. Drop an uncertain
    // control session, but never claim disconnection guarantees physical unloading.
    if (this.controlAttempted && !this.supervisor.stopConfirmed)
      this.source.device.gatt?.disconnect();
    this.release();
  }
}
