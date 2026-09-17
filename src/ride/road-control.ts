import type { RideEngine } from './engine';
import { routePosition, validateRoute, type Route } from './terrain';
import type { PilotSnapshot } from '../trainer/pilot';
import { roadControlRange } from './control-range';

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
};
export type RoadControlFactory = (changed: (snapshot: PilotSnapshot) => void) => Promise<Adapter>;
/** One explicit arming attempt. Resume creates a new instance after shutdown completes. */
export class RoadControl {
  ready = false;
  ending = false;
  ended = false;
  snapshot?: PilotSnapshot;
  message = 'Preparing trainer for flat SIM. The ride clock is waiting.';
  private cancelled = false;
  private adapter?: Adapter;
  private pending?: Promise<void>;
  private shutdown?: Promise<void>;
  private lastEvent = '';
  constructor(
    private engine: RideEngine,
    private prepare: RoadControlFactory,
    private changed: () => void,
  ) {
    if (
      engine.session.source !== 'bluetooth' ||
      !engine.session.route ||
      !supportsRoadControl(engine.session.route)
    )
      throw new Error('Trainer-controlled roads must stay between −4% and +5%.');
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
        const event = `${snapshot.state}: ${snapshot.grade ?? 0}%`;
        if (event !== this.lastEvent) {
          this.lastEvent = event;
          this.engine.session.events.push({
            elapsed: this.engine.state.elapsed,
            message: `SIM controller ${event}. ${snapshot.message}`,
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
      this.adapter!.setGrade(
        this.engine.state.phase === 'countdown'
          ? 0
          : routePosition(this.engine.session.route!, this.engine.state.distance * 1000).grade,
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
          message: `SIM control ended. ${this.message}`,
        });
        this.changed();
      }
    });
    this.changed();
    return this.shutdown;
  }
}
