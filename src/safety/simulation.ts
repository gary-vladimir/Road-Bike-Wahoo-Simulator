import {
  ControlQueue,
  encodeControl,
  type ControlCommand,
  type ControlLimits,
} from '../trainer/control';
import { roadPhysics } from '../ride/terrain';
import type { Telemetry } from '../trainer/ftms';
/** Bounded SIM controller; the caller supplies the road or diagnostic slope envelope. */
export class SimulationSupervisor {
  state: 'idle' | 'waiting' | 'arming' | 'running' | 'stopping' | 'stopped' | 'faulted' = 'idle';
  stopConfirmed = false;
  grade = 0;
  message = '';
  private generation = 0;
  private last = 0;
  private busy = false;
  private claimed = false;
  private ending?: Promise<void>;
  constructor(
    private queue: ControlQueue,
    private limits: ControlLimits,
    private telemetry: () => Telemetry,
    private now = () => performance.now(),
  ) {}
  private command(grade: number): ControlCommand {
    return {
      kind: 'simulation',
      grade,
      windSpeed: roadPhysics.windSpeed,
      rollingResistance: roadPhysics.rollingResistance,
      windResistance: roadPhysics.windResistance,
    };
  }
  private guard() {
    const t = this.telemetry(),
      now = this.now();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(t.power) ||
      t.powerAt === undefined ||
      !Number.isFinite(t.powerAt) ||
      now < t.powerAt ||
      now - t.powerAt > 2500
    )
      throw new Error('Fresh power is required for terrain control');
    // Coasting and low cadence are valid in SIM; never impose ERG's 50 rpm threshold.
  }
  async arm(readiness: { baselineConfirmed: boolean; trainerProfileConfirmed: boolean }) {
    if (!['idle', 'waiting'].includes(this.state))
      throw new Error('Create a new SIM session to resume');
    if (!readiness.baselineConfirmed || !readiness.trainerProfileConfirmed)
      throw new Error(
        'Confirm the comfortable baseline and trainer mass/profile before SIM control',
      );
    this.guard();
    encodeControl(this.command(0), this.limits);
    const generation = ++this.generation;
    this.state = 'arming';
    try {
      await this.queue.send({ kind: 'request' });
      this.claimed = true;
      if (generation !== this.generation) return;
      this.guard();
      await this.queue.send(this.command(0));
      if (generation !== this.generation) return;
      this.guard();
      await this.queue.send({ kind: 'start' });
      if (generation !== this.generation) return;
      this.guard();
      this.state = 'running';
      this.last = this.now();
    } catch (error) {
      if (generation === this.generation) await this.end((error as Error).message);
    }
  }
  async update(requestedGrade: number) {
    if (this.state !== 'running') return;
    try {
      this.guard();
      encodeControl(this.command(requestedGrade), this.limits);
    } catch (error) {
      await this.end((error as Error).message);
      return;
    }
    if (this.busy) return;
    const generation = this.generation;
    this.busy = true;
    try {
      const elapsed = this.now() - this.last;
      if (elapsed < 0 || elapsed > 2500) throw new Error('Terrain control timing interrupted');
      if (elapsed < 1000) return;
      const next =
        Math.round(
          (this.grade +
            Math.sign(requestedGrade - this.grade) *
              Math.min(Math.abs(requestedGrade - this.grade), 0.25)) *
            100,
        ) / 100;
      if (next !== this.grade) {
        await this.queue.send(this.command(next));
        if (generation !== this.generation) return;
        this.grade = next;
      }
      this.last = this.now();
    } catch (error) {
      if (generation === this.generation) await this.end((error as Error).message);
    } finally {
      this.busy = false;
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
  async checkTelemetry() {
    if (this.ending) {
      await this.ending;
      return;
    }
    if (this.state !== 'running') return;
    try {
      this.guard();
    } catch (error) {
      await this.end((error as Error).message);
    }
  }
  stop() {
    return this.end();
  }
  fault(reason: string) {
    return this.end(reason);
  }
  private end(reason?: string): Promise<void> {
    if (this.ending) return this.ending;
    const wasActive = !['idle', 'waiting'].includes(this.state);
    ++this.generation;
    this.state = 'stopping';
    this.ending = (async () => {
      try {
        if (wasActive || this.claimed) {
          await this.queue.stop();
          this.stopConfirmed = true;
        }
        this.state = reason ? 'faulted' : 'stopped';
        this.message = `${reason ? reason + '. ' : ''}${wasActive ? 'Stop acknowledged; physical unloading is unverified.' : 'Cancelled before control.'}`;
      } catch {
        this.state = 'faulted';
        this.message = `${reason ?? 'Stop failed'}. Physical load state is unknown.`;
      }
    })();
    return this.ending;
  }
}
