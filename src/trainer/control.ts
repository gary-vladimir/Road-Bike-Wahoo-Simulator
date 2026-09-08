/** Bounded commands used only by the explicitly armed diagnostic pilot. */
export type ControlCommand =
  | { kind: 'request' }
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'power'; watts: number }
  | {
      kind: 'simulation';
      grade: number;
      windSpeed: number;
      rollingResistance: number;
      windResistance: number;
    };
export type ControlLimits = {
  min: number;
  max: number;
  increment: number;
  ceiling: number;
  simulation?: { minGrade: number; maxGrade: number };
};
export function encodeControl(command: ControlCommand, limits: ControlLimits): Uint8Array {
  if (command.kind === 'request') return Uint8Array.of(0x00);
  if (command.kind === 'start') return Uint8Array.of(0x07);
  if (command.kind === 'stop') return Uint8Array.of(0x08, 0x01);
  if (command.kind === 'simulation') {
    const allowed = limits.simulation;
    const { grade, windSpeed, rollingResistance, windResistance } = command;
    if (
      !allowed ||
      ![
        allowed.minGrade,
        allowed.maxGrade,
        grade,
        windSpeed,
        rollingResistance,
        windResistance,
      ].every(Number.isFinite) ||
      allowed.minGrade < -6 ||
      allowed.maxGrade > 6 ||
      allowed.minGrade > allowed.maxGrade ||
      grade < allowed.minGrade ||
      grade > allowed.maxGrade ||
      Math.abs(windSpeed) > 10 ||
      rollingResistance < 0 ||
      rollingResistance > 0.01 ||
      windResistance < 0 ||
      windResistance > 0.6
    )
      throw new Error('Simulation command is not authorized or exceeds configured limits');
    const bytes = new Uint8Array(7),
      view = new DataView(bytes.buffer);
    bytes[0] = 0x11;
    view.setInt16(1, Math.round(windSpeed * 1000), true);
    view.setInt16(3, Math.round(grade * 100), true);
    bytes[5] = Math.round(rollingResistance * 10000);
    bytes[6] = Math.round(windResistance * 100);
    return bytes;
  }
  if (command.kind !== 'power') throw new Error('Unsupported control command');
  const { watts } = command;
  if (
    ![limits.min, limits.max, limits.increment, limits.ceiling, watts].every(Number.isFinite) ||
    limits.increment <= 0 ||
    limits.min > limits.max ||
    limits.ceiling > 150 ||
    limits.ceiling < 40 ||
    !Number.isInteger(watts) ||
    watts < Math.max(40, limits.min) ||
    watts > Math.min(limits.max, limits.ceiling) ||
    (watts - limits.min) % limits.increment !== 0
  )
    throw new Error('Power target is outside the validated pilot limits');
  const bytes = new Uint8Array(3);
  bytes[0] = 0x05;
  new DataView(bytes.buffer).setInt16(1, watts, true);
  return bytes;
}
export interface ControlWire {
  write(bytes: Uint8Array): Promise<void>;
  subscribe(callback: (value: DataView) => void): () => void;
}
type Entry = {
  command: ControlCommand;
  bytes: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
  written: boolean;
  response?: number;
  timer?: ReturnType<typeof setTimeout>;
};
export type AuditEntry = { at: number; event: string; bytes?: number[]; result?: number };
/** Single in-flight operation, matched indications, no retries, stop supersedes queued load. */
export class ControlQueue {
  readonly audit: AuditEntry[] = [];
  private pending?: Entry;
  private entries: Entry[] = [];
  private sealed = false;
  private closed = false;
  private unsubscribe: () => void;
  private stopPromise?: Promise<void>;
  constructor(
    private wire: ControlWire,
    private limits: ControlLimits,
    private timeoutMs = 2500,
    private now = () => performance.now(),
  ) {
    this.unsubscribe = wire.subscribe((value) => this.indication(value));
  }
  private log(event: string, bytes?: number[], result?: number) {
    this.audit.push({ at: this.now(), event, bytes, result });
    if (this.audit.length > 200) this.audit.shift();
  }
  send(command: ControlCommand): Promise<void> {
    if (command.kind === 'stop') return this.stop();
    if (this.closed || this.sealed)
      return Promise.reject(
        new Error('Control queue is stopped or faulted; establish a new session'),
      );
    let bytes: Uint8Array;
    try {
      bytes = encodeControl(command, this.limits);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      this.entries.push({ command, bytes, resolve, reject, written: false });
      this.pump();
    });
  }
  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.sealed = true;
    this.rejectQueued(new Error('Superseded by stop'));
    if (this.closed)
      return Promise.reject(new Error('Connection unavailable; physical load state is unknown'));
    this.stopPromise = new Promise((resolve, reject) => {
      this.entries.unshift({
        command: { kind: 'stop' },
        bytes: Uint8Array.of(0x08, 0x01),
        resolve,
        reject,
        written: false,
      });
      this.pump();
    });
    return this.stopPromise;
  }
  private rejectQueued(error: Error) {
    for (const entry of this.entries.splice(0)) entry.reject(error);
  }
  private pump() {
    if (this.pending || this.closed) return;
    const entry = this.entries.shift();
    if (!entry) return;
    this.pending = entry;
    this.log('write', Array.from(entry.bytes));
    entry.timer = setTimeout(() => {
      if (this.pending !== entry) return;
      // A still-unsettled platform write cannot safely be overlapped with another write.
      if (!entry.written) {
        this.closed = true;
        this.rejectQueued(new Error('Platform write stalled; physical load state is unknown'));
      }
      this.fail(
        entry,
        new Error('Trainer acknowledgement timed out; physical load state is unknown'),
      );
    }, this.timeoutMs);
    Promise.resolve()
      .then(() => {
        if (this.closed || this.pending !== entry) return;
        return this.wire.write(entry.bytes);
      })
      .then(() => {
        if (this.pending !== entry) return;
        entry.written = true;
        if (entry.response !== undefined) this.complete(entry);
      })
      .catch((error) => {
        if (this.pending === entry) {
          entry.written = true;
          this.fail(entry, error instanceof Error ? error : new Error(String(error)));
        }
      });
  }
  private indication(value: DataView) {
    if (this.closed || !this.pending) return;
    if (value.byteLength !== 3 || value.getUint8(0) !== 0x80) {
      this.fail(this.pending, new Error('Malformed control response'));
      return;
    }
    const opcode = value.getUint8(1),
      result = value.getUint8(2);
    if (opcode !== this.pending.bytes[0]) {
      this.log('ignored unrelated indication', undefined, result);
      return;
    }
    if (result < 1 || result > 5) {
      this.fail(this.pending, new Error('Unknown control result'));
      return;
    }
    this.pending.response = result;
    if (this.pending.written) this.complete(this.pending);
  }
  private complete(entry: Entry) {
    this.log('acknowledgement', Array.from(entry.bytes), entry.response);
    if (entry.response !== 1) {
      this.fail(
        entry,
        new Error(`Trainer rejected opcode ${entry.bytes[0]} (result ${entry.response})`),
      );
      return;
    }
    clearTimeout(entry.timer);
    this.pending = undefined;
    entry.resolve();
    this.pump();
  }
  private fail(entry: Entry, error: Error) {
    if (!entry.written) this.closed = true;
    this.log(error.message, Array.from(entry.bytes));
    clearTimeout(entry.timer);
    this.pending = undefined;
    this.sealed = true;
    // Retain only an explicit stop request; never replay queued targets after a fault.
    const queued = this.entries.splice(0);
    for (const item of queued) {
      if (item.command.kind === 'stop' && !this.closed) this.entries.push(item);
      else item.reject(error);
    }
    entry.reject(error);
    this.pump();
  }
  close() {
    this.closed = true;
    this.sealed = true;
    this.unsubscribe();
    const error = new Error('Connection closed; physical load state is unknown');
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    this.rejectQueued(error);
    this.log('connection closed');
  }
}
