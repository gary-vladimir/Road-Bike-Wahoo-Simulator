import {
  ControlQueue,
  encodeControl,
  type AuditEntry,
  type ControlLimits,
  type ControlWire,
} from './control';
import type { Telemetry } from './ftms';
import { createSetup, windCoefficient, type PhysicsSetup } from '../ride/physics';

/**
 * One explicit trainer-control session (a ride, a workout, an FTP test or a manual check).
 *
 *   waiting ─(fresh telemetry)→ arming ─(request, first load, start)→ active ⇄ holding
 *      │                                                                  │
 *      └──────────────── release (flat road, keep telemetry) / stop / fault ┘
 *
 * - Pairing never arms a session. Control starts only after the rider starts it.
 * - Pausing holds a light load (ERG recovery watts or a flat SIM road). It never sends FTMS
 *   Stop, because Stop hands the KICKR back to its heavier default load.
 * - ERG rides through brief cadence dropouts. Sustained low cadence drops to the recovery load
 *   until the rider spins up again, instead of ending control.
 * - Load reductions apply immediately; increases are rate limited.
 * - Only faults (rejected or unacknowledged commands, lost connection) send FTMS Stop.
 */
export type ControlMode = 'erg' | 'sim';
export type SessionState =
  'waiting' | 'arming' | 'active' | 'holding' | 'releasing' | 'stopping' | 'ended' | 'faulted';

export type TrainerSource = {
  device: BluetoothDevice;
  range: { min: number; max: number; increment: number };
  telemetry: () => Telemetry;
};

export const ergBehavior = Object.freeze({
  /** Below this cadence an ERG load becomes hard to turn over (rpm). */
  lowCadence: 50,
  /** Cadence needed to leave the recovery load again (rpm). */
  resumeCadence: 55,
  /** A low-cadence spell must last this long before the load drops (ms). */
  lowCadenceMs: 3000,
  /** Spin-up time above the resume cadence before targets return (ms). */
  resumeMs: 2000,
  /** Largest per-second increase of an ERG target (W). */
  rampUpPerSecond: 25,
});
export const simBehavior = Object.freeze({
  /** Largest per-second change of the trainer slope (percentage points). */
  stepPerSecond: 0.5,
});
/** Slope envelopes after trainer-difficulty scaling. The KICKR CORE 2 simulates up to 16%. */
export const gradeEnvelopes = Object.freeze({
  road: Object.freeze({ minGrade: -10, maxGrade: 12 }),
  diagnostic: Object.freeze({ minGrade: -1, maxGrade: 1 }),
  /** ERG sessions may only switch to a flat road when they end. */
  flat: Object.freeze({ minGrade: 0, maxGrade: 0 }),
});
export const staleTelemetryMs = 3000;

export type RoadCoefficients = {
  windSpeed: number;
  rollingResistance: number;
  windResistance: number;
};
/** Match trainer load to the virtual physics: the same rolling and aerodynamic coefficients. */
export function roadCoefficients(setup: PhysicsSetup = createSetup({ riderMass: 70 })) {
  return {
    windSpeed: setup.windSpeed,
    rollingResistance: setup.crr,
    // FTMS resolution is 0.01 kg/m.
    windResistance: Math.round(windCoefficient(setup) * 100) / 100,
  };
}

export type SessionOptions = {
  mode: ControlMode;
  /** Highest ERG target this session may command. Workouts and FTP tests allow up to 600 W. */
  powerCeiling?: number;
  /** Diagnostic sessions stay within a 50–100 W grant. */
  purpose?: 'ride' | 'diagnostic';
  /** First ERG load after arming; also the recovery and pause load. */
  startupWatts?: 50 | 75 | 100;
  road?: RoadCoefficients;
};

export type SessionSnapshot = {
  state: SessionState;
  mode: ControlMode;
  message: string;
  /** ERG low-cadence recovery load in effect. */
  recovery: boolean;
  requestedWatts?: number;
  appliedWatts?: number;
  requestedGrade?: number;
  appliedGrade?: number;
  stopConfirmed: boolean;
  releaseConfirmed: boolean;
  audit: AuditEntry[];
  machineStatus: { at: number; bytes: number[] }[];
};

let controlAllowed = () => false;
/** The app wires this to the rider's Settings switch; control is refused while it is off. */
export function setControlGate(allowed: () => boolean) {
  controlAllowed = allowed;
}

/** Resolves to an unlock function that settles once the lock is actually free again. */
async function acquireLock(): Promise<() => Promise<void>> {
  if (!navigator.locks) throw new Error('Exclusive browser control locking is unavailable.');
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const request = navigator.locks.request(
      'bikesim-trainer-control',
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          reject(new Error('Another BikeSIM tab is controlling the trainer.'));
          return;
        }
        resolve(async () => {
          release();
          await request.catch(() => {});
        });
        await held;
      },
    );
    request.catch(reject);
  });
}

const fresh = (value: number | undefined, at: number | undefined, now: number) =>
  value !== undefined &&
  Number.isFinite(value) &&
  at !== undefined &&
  Number.isFinite(at) &&
  at <= now &&
  now - at <= staleTelemetryMs;

export class TrainerSession {
  state: SessionState = 'waiting';
  message = '';
  recovery = false;
  stopConfirmed = false;
  releaseConfirmed = false;
  readonly mode: ControlMode;
  private queue: ControlQueue;
  private limits: ControlLimits;
  private startupWatts: number;
  private road: RoadCoefficients;
  private gradeRange: { minGrade: number; maxGrade: number };
  private desired: number;
  private applied?: number;
  private wantHold = false;
  private claimed = false;
  private controlAttempted = false;
  private busy = false;
  private lastCommandAt = -Infinity;
  private lastTick?: number;
  private lowSince?: number;
  private highSince?: number;
  private timer?: ReturnType<typeof setInterval>;
  private ending?: Promise<void>;
  private disposed = false;
  private statuses: { at: number; bytes: number[] }[] = [];

  private constructor(
    private source: TrainerSource,
    private point: BluetoothRemoteGATTCharacteristic,
    private status: BluetoothRemoteGATTCharacteristic,
    private unlock: () => Promise<void>,
    private changed: (snapshot: SessionSnapshot) => void,
    options: SessionOptions,
    private now: () => number,
  ) {
    this.mode = options.mode;
    this.startupWatts = options.startupWatts ?? 50;
    this.road = options.road ?? roadCoefficients();
    this.gradeRange =
      options.mode === 'erg'
        ? gradeEnvelopes.flat
        : options.purpose === 'diagnostic'
          ? gradeEnvelopes.diagnostic
          : gradeEnvelopes.road;
    const workout = options.mode === 'erg' && options.purpose !== 'diagnostic';
    this.limits = {
      ...source.range,
      ceiling:
        options.mode === 'erg' ? (options.powerCeiling ?? 100) : Math.max(this.startupWatts, 100),
      startupWatts: this.startupWatts,
      ...(workout ? { powerMode: 'workout' as const } : {}),
      simulation: this.gradeRange,
    };
    this.desired = options.mode === 'erg' ? this.startupWatts : 0;
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
    this.queue = new ControlQueue(wire, this.limits);
    this.message =
      this.mode === 'sim'
        ? 'Waiting for live power. Coasting at 0 W is fine.'
        : 'Pedal above 50 rpm to start ERG.';
  }

  /** Acquire exclusive control and subscribe to responses. Sends no commands. */
  static async open(
    source: TrainerSource,
    options: SessionOptions,
    changed: (snapshot: SessionSnapshot) => void,
    now = () => performance.now(),
  ): Promise<TrainerSession> {
    if (!controlAllowed())
      throw new Error('Trainer control is off. Turn it on in Settings to let BikeSIM set load.');
    const { mode, startupWatts = 50, purpose = 'ride' } = options;
    if (![50, 75, 100].includes(startupWatts) || (purpose === 'diagnostic' && startupWatts !== 50))
      throw new Error('An ERG starting load of 50, 75 or 100 W is required.');
    if (mode === 'erg') {
      const ceiling = options.powerCeiling ?? 100;
      const cap = purpose === 'diagnostic' ? 100 : 600;
      if (!Number.isInteger(ceiling) || ceiling < startupWatts || ceiling > cap)
        throw new Error(
          `ERG sessions need a whole-watt ceiling between the start load and ${cap} W.`,
        );
      if (source.range.increment !== 1 || source.range.min > 40 || source.range.max < ceiling)
        throw new Error('The trainer power range cannot represent these targets.');
    }
    if (document.hidden) throw new Error('Keep BikeSIM visible while starting trainer control.');
    const unlock = await acquireLock();
    let session: TrainerSession | undefined;
    try {
      if (!source.device.gatt?.connected) throw new Error('Pair the trainer first.');
      const service = await source.device.gatt.getPrimaryService(0x1826);
      const point = await service.getCharacteristic(0x2ad9),
        status = await service.getCharacteristic(0x2ada);
      if (!point.properties.write || !point.properties.indicate)
        throw new Error('The trainer must acknowledge control writes.');
      session = new TrainerSession(source, point, status, unlock, changed, options, now);
      await point.startNotifications();
      status.addEventListener('characteristicvaluechanged', session.machineStatus);
      await status.startNotifications();
      source.device.addEventListener('gattserverdisconnected', session.disconnected);
      window.addEventListener('pagehide', session.leaving);
      session.timer = setInterval(() => void session!.loop(), 250);
      session.emit();
      return session;
    } catch (error) {
      if (session) await session.dispose();
      else await unlock();
      throw error;
    }
  }

  snapshot(): SessionSnapshot {
    const erg = this.mode === 'erg';
    return {
      state: this.state,
      mode: this.mode,
      message: this.message,
      recovery: this.recovery,
      requestedWatts: erg ? this.desired : undefined,
      appliedWatts: erg ? this.applied : undefined,
      requestedGrade: erg ? undefined : this.desired,
      appliedGrade: erg ? undefined : this.applied,
      stopConfirmed: this.stopConfirmed,
      releaseConfirmed: this.releaseConfirmed,
      audit: [...this.queue.audit],
      machineStatus: [...this.statuses],
    };
  }

  /** Follow a target: ERG watts, or SIM slope (%) after difficulty scaling. Ends any hold. */
  follow(value: number) {
    if (!Number.isFinite(value)) throw new Error('Trainer target must be a number.');
    if (this.mode === 'erg') {
      const watts = Math.round(value);
      // Throws for anything outside this session's grant; callers must never exceed it.
      encodeControl({ kind: 'power', watts }, this.limits);
      this.desired = watts;
    } else {
      this.desired =
        Math.round(
          Math.min(this.gradeRange.maxGrade, Math.max(this.gradeRange.minGrade, value)) * 100,
        ) / 100;
    }
    this.wantHold = false;
  }

  /** Hold a light load: the ERG recovery load or a flat road. Control stays with BikeSIM. */
  hold() {
    this.wantHold = true;
  }

  get holding() {
    return this.wantHold;
  }

  private emit() {
    this.changed(this.snapshot());
  }

  private async send(value: number) {
    if (this.mode === 'erg') await this.queue.send({ kind: 'power', watts: value });
    else await this.queue.send({ kind: 'simulation', grade: value, ...this.road });
  }

  private async loop() {
    if (this.busy || this.ending || this.disposed) return;
    const now = this.now();
    const telemetry = this.source.telemetry();
    const gap = this.lastTick === undefined ? 0 : now - this.lastTick;
    this.lastTick = now;
    if (this.state === 'waiting') {
      if (!this.wantHold) await this.tryArm(telemetry, now);
      return;
    }
    if (this.state !== 'active' && this.state !== 'holding') return;
    if (gap > 2500 && !this.wantHold) {
      // A frozen tab cannot follow targets on time: hold a light load until the rider resumes.
      this.wantHold = true;
      this.message = 'Timing was interrupted, so BikeSIM is holding a light load.';
    }
    const next = this.mode === 'erg' ? this.nextWatts(telemetry, now) : this.nextGrade(now);
    const state = this.wantHold ? 'holding' : 'active';
    if (state !== this.state) {
      this.state = state;
      this.message =
        state === 'holding'
          ? this.mode === 'erg'
            ? `Paused · holding a light ${this.startupWatts} W.`
            : 'Paused · holding a flat road.'
          : this.mode === 'erg'
            ? 'ERG active.'
            : 'Terrain control active.';
      this.emit();
    }
    if (next === undefined) return;
    this.busy = true;
    try {
      await this.send(next);
      this.applied = next;
      this.lastCommandAt = this.now();
    } catch (error) {
      await this.fault((error as Error).message);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private nextWatts(t: Telemetry, now: number) {
    const b = ergBehavior;
    const cadenceFresh = fresh(t.cadence, t.cadenceAt, now);
    if (cadenceFresh && t.cadence! >= b.lowCadence) this.lowSince = undefined;
    else this.lowSince ??= now;
    if (cadenceFresh && t.cadence! >= b.resumeCadence) this.highSince ??= now;
    else this.highSince = undefined;
    if (!this.recovery && this.lowSince !== undefined && now - this.lowSince >= b.lowCadenceMs) {
      this.recovery = true;
      this.message = `Low cadence · easing to ${this.startupWatts} W. Spin up to continue.`;
      this.emit();
    } else if (
      this.recovery &&
      this.highSince !== undefined &&
      now - this.highSince >= b.resumeMs
    ) {
      this.recovery = false;
      this.message = 'Cadence is back · returning to your target.';
      this.emit();
    }
    const goal = this.wantHold || this.recovery ? this.startupWatts : this.desired;
    const current = this.applied ?? this.startupWatts;
    if (goal === current) return undefined;
    // Dropping load is the safe direction: apply it at once.
    if (goal < current) return goal;
    if (now - this.lastCommandAt < 1000) return undefined;
    return Math.min(goal, current + b.rampUpPerSecond);
  }

  private nextGrade(now: number) {
    const goal = this.wantHold ? 0 : this.desired;
    const current = this.applied ?? 0;
    if (Math.abs(goal - current) < 0.005) return undefined;
    if (this.wantHold) return 0;
    if (now - this.lastCommandAt < 1000) return undefined;
    const step =
      Math.sign(goal - current) * Math.min(Math.abs(goal - current), simBehavior.stepPerSecond);
    return Math.round((current + step) * 100) / 100;
  }

  private async tryArm(t: Telemetry, now: number) {
    const powerFresh = fresh(t.power, t.powerAt, now);
    const cadenceReady =
      this.mode === 'sim' ||
      (fresh(t.cadence, t.cadenceAt, now) && t.cadence! >= ergBehavior.lowCadence);
    if (!powerFresh || !cadenceReady) {
      const message =
        this.mode === 'sim'
          ? 'Waiting for live power. Coasting at 0 W is fine.'
          : 'Pedal above 50 rpm to start ERG. No load has been set yet.';
      if (message !== this.message) {
        this.message = message;
        this.emit();
      }
      return;
    }
    this.state = 'arming';
    this.busy = true;
    this.message = 'Taking control of the trainer…';
    this.emit();
    try {
      await this.queue.send({ kind: 'request' });
      this.claimed = true;
      const first = this.mode === 'erg' ? this.startupWatts : 0;
      await this.send(first);
      this.applied = first;
      await this.queue.send({ kind: 'start' });
      this.lastCommandAt = this.now();
      this.lastTick = this.now();
      if (this.ending) return;
      this.state = this.wantHold ? 'holding' : 'active';
      this.message =
        this.mode === 'erg'
          ? `ERG active at ${first} W.`
          : 'Flat road set. Terrain control active.';
    } catch (error) {
      await this.fault((error as Error).message);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /**
   * End normally: leave the trainer on a flat road and keep telemetry. No FTMS Stop, so the
   * KICKR does not jump back to its heavier default load.
   */
  release(): Promise<void> {
    if (this.ending) return this.ending;
    clearInterval(this.timer);
    this.ending = (async () => {
      if (!this.claimed) {
        this.state = 'ended';
        this.message = 'Trainer control cancelled before any load was set.';
        this.emit();
        await this.dispose();
        return;
      }
      this.state = 'releasing';
      this.message = 'Leaving the trainer on a flat road…';
      this.emit();
      try {
        await this.queue.send({ kind: 'simulation', grade: 0, ...this.road });
        this.releaseConfirmed = true;
        this.state = 'ended';
        this.message = 'Trainer control ended on a flat road.';
      } catch (error) {
        this.state = 'faulted';
        this.message = `Could not set a flat road: ${(error as Error).message}.`;
        try {
          await this.queue.stop();
          this.stopConfirmed = true;
          this.message += ' Stop acknowledged; the trainer may return to its default load.';
        } catch {
          this.message += ' Physical load state is unknown.';
        }
      }
      this.emit();
      await this.dispose();
    })();
    return this.ending;
  }

  /** Send FTMS Stop. The KICKR then returns to its own default load, which may feel heavier. */
  stop(): Promise<void> {
    if (this.ending) return this.ending;
    clearInterval(this.timer);
    this.ending = (async () => {
      if (!this.claimed) {
        this.state = 'ended';
        this.message = 'Trainer control cancelled before any load was set.';
      } else {
        this.state = 'stopping';
        this.emit();
        try {
          await this.queue.stop();
          this.stopConfirmed = true;
          this.state = 'ended';
          this.message = 'Stop acknowledged. The trainer is back on its default load.';
        } catch (error) {
          this.state = 'faulted';
          this.message = `Stop failed: ${(error as Error).message}.`;
        }
      }
      this.emit();
      await this.dispose();
    })();
    return this.ending;
  }

  fault(reason: string): Promise<void> {
    if (this.ending) return this.ending;
    clearInterval(this.timer);
    this.state = 'faulted';
    this.message = reason;
    this.ending = (async () => {
      this.emit();
      if (this.claimed) {
        try {
          await this.queue.stop();
          this.stopConfirmed = true;
          this.message += ' Stop acknowledged.';
        } catch {
          this.message += ' Stop could not be confirmed; physical load state is unknown.';
        }
      }
      this.emit();
      await this.dispose();
    })();
    return this.ending;
  }

  private machineStatus = (e: Event) => {
    const data = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!data) return;
    this.statuses.push({
      at: this.now(),
      bytes: Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
    });
    if (this.statuses.length > 200) this.statuses.shift();
    // Reset, stopped by the user or safety key, or control permission lost.
    if (
      data.byteLength &&
      [0x01, 0x02, 0x03, 0xff].includes(data.getUint8(0)) &&
      ['arming', 'active', 'holding'].includes(this.state) &&
      !this.ending
    ) {
      clearInterval(this.timer);
      this.claimed = false;
      this.state = 'ended';
      this.message = 'The trainer stopped, reset, or handed control to another app.';
      this.emit();
      this.ending = this.dispose();
      return;
    }
    this.emit();
  };

  private disconnected = () => {
    this.queue.close();
    void this.fault('Bluetooth disconnected. Physical load state is unknown.');
  };

  private leaving = () => {
    // Best effort while the page unloads; there may be no time for an acknowledgement.
    void this.release();
  };

  private async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    window.removeEventListener('pagehide', this.leaving);
    this.source.device.removeEventListener('gattserverdisconnected', this.disconnected);
    this.status.removeEventListener('characteristicvaluechanged', this.machineStatus);
    this.queue.close();
    // Keep telemetry after a confirmed release or stop. An uncertain control session is
    // dropped, but disconnecting never proves the trainer unloaded.
    if (this.controlAttempted && !this.stopConfirmed && !this.releaseConfirmed)
      this.source.device.gatt?.disconnect();
    await this.unlock();
  }
}
