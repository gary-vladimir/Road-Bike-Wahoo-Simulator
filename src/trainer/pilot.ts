import { ControlQueue, type AuditEntry, type ControlWire } from './control';
import { PowerSupervisor, type PilotState } from '../safety/supervisor';
import type { Telemetry } from './ftms';
export type PilotSnapshot = {
  state: PilotState;
  applied: number;
  message: string;
  audit: AuditEntry[];
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
/** Bounded manual ERG pilot. Never created by connection or ordinary ride startup. */
export class ErgPilot {
  private timer?: ReturnType<typeof setInterval>;
  private target = 50;
  private disposed = false;
  private shutdown?: Promise<void>;
  private checking = false;
  private supervisor: PowerSupervisor;
  private status: BluetoothRemoteGATTCharacteristic;
  private point: BluetoothRemoteGATTCharacteristic;
  private queue: ControlQueue;
  private snapshot(): PilotSnapshot {
    return {
      state: this.supervisor.state,
      applied: this.supervisor.applied,
      message: this.supervisor.message,
      audit: [...this.queue.audit],
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
  ) {
    this.point = point;
    this.status = status;
    const wire: ControlWire = {
      write: (bytes) => point.writeValueWithResponse(Uint8Array.from(bytes).buffer),
      subscribe: (callback) => {
        const notify = (e: Event) => {
          const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (value) callback(value);
        };
        point.addEventListener('characteristicvaluechanged', notify);
        return () => point.removeEventListener('characteristicvaluechanged', notify);
      },
    };
    this.queue = new ControlQueue(wire, { ...source.range, ceiling: 100 });
    this.supervisor = new PowerSupervisor(
      this.queue,
      { ...source.range, ceiling: 100 },
      source.telemetry,
    );
  }
  static async prepare(
    source: PilotDevice,
    changed: (s: PilotSnapshot) => void,
  ): Promise<ErgPilot> {
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
      pilot = new ErgPilot(source, point, status, release, changed);
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
  async start() {
    if (this.disposed || document.hidden) {
      await this.stop();
      return;
    }
    try {
      await this.supervisor.arm();
    } catch (error) {
      this.supervisor.state = 'faulted';
      this.supervisor.message = (error as Error).message;
    }
    this.emit();
    if (this.supervisor.state !== 'running') {
      await this.shutdown;
      this.dispose();
      return;
    }
    this.timer = setInterval(() => {
      if (this.shutdown || this.disposed) return;
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
  }
  setTarget(watts: number) {
    if (!Number.isInteger(watts) || watts < 50 || watts > 100)
      throw new Error('The supervised test is limited to 50–100 W.');
    this.target = watts;
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
      await this.supervisor.stop();
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
    // Disconnect releases this client's control permission; it is not proof of unloading.
    this.source.device.gatt?.disconnect();
    this.release();
  }
}
