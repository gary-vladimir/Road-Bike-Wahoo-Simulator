import { ControlQueue, encodeControl, type ControlLimits } from '../trainer/control';
import type { Telemetry } from '../trainer/ftms';
export type PilotState =
  'idle' | 'waiting' | 'arming' | 'running' | 'stopping' | 'stopped' | 'faulted';
/** Bounded ERG pilot; ordinary workouts never construct this supervisor. */
export class PowerSupervisor {
  state: PilotState = 'idle';
  message = '';
  applied = 50;
  private generation = 0;
  private last = 0;
  private updating = false;
  private claimed = false;
  private finishing?: Promise<void>;
  stopConfirmed = false;
  constructor(
    private queue: ControlQueue,
    private limits: ControlLimits,
    private telemetry: () => Telemetry,
    private now = () => performance.now(),
  ) {}
  private guard() {
    const t = this.telemetry(),
      now = this.now();
    if (
      t.power === undefined ||
      !Number.isFinite(t.power) ||
      t.cadence === undefined ||
      !Number.isFinite(t.cadence) ||
      t.powerAt === undefined ||
      t.cadenceAt === undefined ||
      !Number.isFinite(t.powerAt) ||
      !Number.isFinite(t.cadenceAt) ||
      now - t.powerAt > 2500 ||
      now - t.cadenceAt > 2500 ||
      now < t.powerAt ||
      now < t.cadenceAt
    )
      throw new Error('Fresh power and cadence are required');
    if (t.cadence < 50) throw new Error('Cadence below pilot minimum: 50 rpm');
  }
  async arm() {
    if (!['idle', 'waiting'].includes(this.state))
      throw new Error('A new control session is required to re-arm');
    this.guard();
    encodeControl({ kind: 'power', watts: 50 }, this.limits);
    const generation = ++this.generation;
    this.state = 'arming';
    try {
      await this.queue.send({ kind: 'request' });
      this.claimed = true;
      if (generation !== this.generation) return;
      this.guard();
      await this.queue.send({ kind: 'power', watts: 50 });
      if (generation !== this.generation) return;
      this.guard();
      await this.queue.send({ kind: 'start' });
      if (generation !== this.generation) return;
      this.guard();
      this.state = 'running';
      this.last = this.now();
      this.applied = 50;
    } catch (error) {
      if (generation === this.generation) await this.fault((error as Error).message);
    }
  }
  preflight(): string | null {
    try {
      this.guard();
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  }
  async update(target: number) {
    if (this.state !== 'running') return;
    try {
      this.guard();
      encodeControl({ kind: 'power', watts: target }, this.limits);
    } catch (error) {
      await this.fault((error as Error).message);
      return;
    }
    if (this.updating) return;
    this.updating = true;
    const generation = this.generation;
    try {
      this.guard();
      encodeControl({ kind: 'power', watts: target }, this.limits);
      const dt = (this.now() - this.last) / 1000;
      if (dt < 0 || dt > 2.5) throw new Error('Control timing interrupted');
      // Commands at most once per second. No accumulated ramp jump after a stall.
      if (dt < 1) return;
      const limited =
        this.applied +
        Math.sign(target - this.applied) * Math.min(Math.abs(target - this.applied), 10);
      const next =
        this.limits.min +
        Math.round((limited - this.limits.min) / this.limits.increment) * this.limits.increment;
      if (Math.abs(next - this.applied) > 10)
        throw new Error('Device increment exceeds pilot ramp limit');
      if (next !== this.applied) {
        await this.queue.send({ kind: 'power', watts: next });
        if (generation !== this.generation) return;
        this.applied = next;
      }
      this.last = this.now();
    } catch (error) {
      if (generation === this.generation) await this.fault((error as Error).message);
    } finally {
      this.updating = false;
    }
  }
  async checkTelemetry() {
    if (this.finishing) {
      await this.finishing;
      return;
    }
    if (this.state !== 'running') return;
    try {
      this.guard();
    } catch (error) {
      await this.fault((error as Error).message);
    }
  }
  stop(): Promise<void> {
    if (this.finishing) return this.finishing;
    if (this.state === 'idle' || this.state === 'waiting') {
      this.state = 'stopped';
      this.message = 'Test cancelled. No resistance commands were sent.';
      return Promise.resolve();
    }
    if (this.state === 'stopped' || this.state === 'faulted') return Promise.resolve();
    ++this.generation;
    this.state = 'stopping';
    this.finishing = this.finishStop();
    return this.finishing;
  }
  private async finishStop() {
    try {
      await this.queue.stop();
      this.stopConfirmed = true;
      this.state = 'stopped';
      this.message = 'Stop acknowledged. Physical unloading still requires hardware validation.';
    } catch (error) {
      this.state = 'faulted';
      this.message = (error as Error).message;
    }
  }
  fault(reason: string): Promise<void> {
    if (this.finishing) return this.finishing;
    ++this.generation;
    this.state = 'faulted';
    this.message = reason;
    this.finishing = this.finishFault();
    return this.finishing;
  }
  private async finishFault() {
    if (this.claimed) {
      try {
        await this.queue.stop();
        this.stopConfirmed = true;
        this.message += ' Stop acknowledged; physical load is not verified.';
      } catch {
        this.message += ' Stop could not be confirmed; physical load state is unknown.';
      }
    }
  }
}
