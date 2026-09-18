import type { RideEngine } from './engine';
import { routePosition, validateRoute, type Route } from './terrain';
import type { PilotSnapshot } from '../trainer/pilot';
import { roadControlRange } from './control-range';
import { workoutControlIssue, workoutTarget } from './workout-control';

export function supportsRoadControl(route: Route) {
  validateRoute(route);
  return route.points.every(
    (point) => point.grade >= roadControlRange.minGrade && point.grade <= roadControlRange.maxGrade,
  );
}
type Adapter = {
  start: (readiness: {
    baselineConfirmed: boolean;
    trainerProfileConfirmed: boolean;
  }) => Promise<void>;
  stop: () => Promise<void>;
  setGrade: (grade: number) => void;
  setTarget: (watts: number) => void;
};
export type RideControlFactory = (changed: (snapshot: PilotSnapshot) => void) => Promise<Adapter>;
/** One explicit arming attempt. Resume creates a new instance after shutdown completes. */
export class RideControl {
  ready = false;
  ending = false;
  ended = false;
  snapshot?: PilotSnapshot;
  message: string;
  private cancelled = false;
  private adapter?: Adapter;
  private pending?: Promise<void>;
  private shutdown?: Promise<void>;
  private lastEvent = '';
  constructor(
    private engine: RideEngine,
    private prepare: RideControlFactory,
    private changed: () => void,
  ) {
    const s = engine.session;
    if (s.source !== 'bluetooth' || !['sim', 'erg'].includes(s.trainerControl ?? ''))
      throw new Error('Choose an explicitly controlled live ride.');
    if (s.trainerControl === 'sim' && (!s.route || !supportsRoadControl(s.route)))
      throw new Error('Trainer-controlled roads must stay between −4% and +5%.');
    if (s.trainerControl === 'erg') {
      const issue = workoutControlIssue(s.workout, s.ftp);
      if (s.route || issue) throw new Error(issue ?? 'ERG workouts cannot control terrain.');
    }
    this.message =
      s.trainerControl === 'sim'
        ? 'Preparing trainer for flat SIM. The ride clock is waiting.'
        : 'Preparing 50 W ERG. Pedal above 50 rpm; the workout clock is waiting.';
  }
  start() {
    if (this.pending || this.cancelled) return this.pending ?? Promise.resolve();
    this.pending = this.arm();
    return this.pending;
  }
  private async arm() {
    try {
      const adapter = await this.prepare((snapshot) => {
        this.snapshot = snapshot;
        this.message = snapshot.message;
        const mode = this.engine.session.trainerControl!;
        const event = `${snapshot.state}: ${mode === 'sim' ? `${snapshot.grade ?? 0}%` : `${snapshot.applied} W`}`;
        if (event !== this.lastEvent) {
          this.lastEvent = event;
          this.engine.session.events.push({
            elapsed: this.engine.state.elapsed,
            message: `${mode.toUpperCase()} controller ${event}. ${snapshot.message}`,
          });
        }
        this.ready = !this.cancelled && snapshot.state === 'running';
        if (!this.cancelled && ['stopping', 'stopped', 'faulted'].includes(snapshot.state)) {
          this.engine.pause(
            snapshot.message || 'Trainer control ended. Resume deliberately when ready.',
          );
          void this.stop();
        }
        this.changed();
      });
      this.adapter = adapter;
      if (this.cancelled) {
        await adapter.stop();
        return;
      }
      await adapter.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    } catch (error) {
      this.ready = false;
      this.message = (error as Error).message;
      if (!this.cancelled) this.engine.pause(this.message);
      // Do not await shutdown here: shutdown also waits for this preparation.
      void this.stop();
      this.changed();
    }
  }
  update() {
    if (['paused', 'finished'].includes(this.engine.state.phase)) {
      void this.stop();
      return;
    }
    if (!this.ready) return;
    try {
      if (this.engine.session.trainerControl === 'sim')
        this.adapter!.setGrade(
          this.engine.state.phase === 'countdown'
            ? 0
            : routePosition(this.engine.session.route!, this.engine.state.distance * 1000).grade,
        );
      else
        this.adapter!.setTarget(
          this.engine.state.phase === 'countdown'
            ? 50
            : workoutTarget(
                this.engine.session.workout,
                this.engine.session.ftp!,
                this.engine.state.elapsed,
                this.engine.state.bias,
              ),
        );
    } catch (error) {
      this.message = (error as Error).message;
      this.engine.pause(this.message);
      void this.stop();
    }
  }
  stop(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.cancelled = true;
    this.ready = false;
    this.ending = true;
    // Defer so the idempotent promise is assigned before stop callbacks can reenter.
    this.shutdown = Promise.resolve().then(async () => {
      try {
        const results = await Promise.allSettled([this.adapter?.stop(), this.pending]);
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      } catch (error) {
        this.message = `Trainer stop failed: ${(error as Error).message}. Physical load is unknown.`;
      } finally {
        this.ending = false;
        this.ended = true;
        this.engine.session.events.push({
          elapsed: this.engine.state.elapsed,
          message: `${this.engine.session.trainerControl!.toUpperCase()} control ended. ${this.message}`,
        });
        this.changed();
      }
    });
    this.changed();
    return this.shutdown;
  }
}
