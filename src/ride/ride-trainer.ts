import type { RideEngine } from './engine';
import { routePosition } from './terrain';
import { workoutControlIssue, workoutPowerCeiling, workoutTarget } from './workout-control';
import type { SessionSnapshot, TrainerSession } from '../trainer/session';

export type OpenSession = (changed: (snapshot: SessionSnapshot) => void) => Promise<TrainerSession>;

/**
 * Drives one trainer session from a ride's phase:
 * countdown → first load (flat road or ERG start load), running → road slope × difficulty or
 * workout watts, paused → light hold, finished → release onto a flat road.
 * If control ends unexpectedly the ride pauses; resuming opens a fresh session.
 */
export class RideTrainer {
  session?: TrainerSession;
  snapshot?: SessionSnapshot;
  message = '';
  private opening?: Promise<void>;
  private finishing?: Promise<void>;
  private lastEvent = '';
  constructor(
    private engine: RideEngine,
    private open: OpenSession,
    private changed: () => void,
    /** Fraction of the road slope the trainer applies (Zwift-style trainer difficulty). */
    public difficulty = 1,
  ) {
    const s = engine.session;
    if (s.source !== 'bluetooth' || !s.trainerControl)
      throw new Error('Choose a trainer-controlled live ride.');
    if (s.trainerControl === 'sim' && !s.route) throw new Error('SIM control needs a road.');
    if (s.trainerControl === 'erg') {
      const issue = workoutControlIssue(s.workout, s.ftp);
      if (s.route || issue) throw new Error(issue ?? 'ERG workouts cannot control terrain.');
    }
    if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 1)
      throw new Error('Trainer difficulty must be between 0% and 100%.');
    this.message =
      s.trainerControl === 'sim'
        ? 'Preparing a flat road on the trainer. The ride clock is waiting.'
        : 'Preparing ERG. Pedal above 50 rpm; the workout clock is waiting.';
  }

  get erg() {
    return this.engine.session.trainerControl === 'erg';
  }

  /** The engine may run once the trainer holds its first load. */
  get ready() {
    return this.snapshot?.state === 'active' || this.snapshot?.state === 'holding';
  }

  get ended() {
    return !this.session || ['ended', 'faulted'].includes(this.snapshot?.state ?? 'ended');
  }

  start() {
    if (this.opening || this.finishing) return this.opening ?? Promise.resolve();
    this.opening = (async () => {
      try {
        this.session = await this.open((snapshot) => this.observe(snapshot));
        if (this.finishing) await this.session.release();
      } catch (error) {
        this.message = (error as Error).message;
        this.engine.pause(this.message);
      } finally {
        this.opening = undefined;
        this.changed();
      }
    })();
    this.changed();
    return this.opening;
  }

  private observe(snapshot: SessionSnapshot) {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    this.message = snapshot.message;
    const value = this.erg
      ? `${snapshot.appliedWatts ?? '—'} W`
      : `${snapshot.appliedGrade ?? '—'}%`;
    const event = `${snapshot.state}${snapshot.recovery ? ' (recovery)' : ''}: ${value}`;
    if (event !== this.lastEvent) {
      this.lastEvent = event;
      this.engine.session.events.push({
        elapsed: this.engine.state.elapsed,
        message: `${this.erg ? 'ERG' : 'SIM'} ${event}. ${snapshot.message}`,
      });
    }
    // Control ended without the rider finishing: pause so the ride never runs uncontrolled.
    if (
      ['ended', 'faulted'].includes(snapshot.state) &&
      previous?.state !== snapshot.state &&
      !this.finishing &&
      this.engine.state.phase !== 'finished'
    )
      this.engine.pause(snapshot.message || 'Trainer control ended.');
    this.changed();
  }

  /** Call on every engine tick. */
  update() {
    const session = this.session;
    if (!session || this.ended) return;
    const { phase, elapsed, distance, bias } = this.engine.state;
    const s = this.engine.session;
    try {
      if (phase === 'finished') void this.finish();
      else if (phase === 'paused') session.hold();
      else if (phase === 'countdown') session.follow(this.erg ? 50 : 0);
      else if (this.erg) session.follow(workoutTarget(s.workout, s.ftp!, elapsed, bias));
      else session.follow(routePosition(s.route!, distance * 1000).grade * this.difficulty);
    } catch (error) {
      this.message = (error as Error).message;
      this.engine.pause(this.message);
      void session.fault(this.message);
    }
  }

  /** Resume after a pause. A session that ended needs a fresh start (and pedaling for ERG). */
  resume() {
    if (this.ended && !this.opening) {
      this.session = undefined;
      this.snapshot = undefined;
      void this.start();
    }
  }

  /** Release onto a flat road. Resolves once the trainer acknowledged (or control failed). */
  finish(): Promise<void> {
    this.finishing ??= (async () => {
      await this.opening;
      await this.session?.release();
      this.changed();
    })();
    return this.finishing;
  }

  static ceiling(engine: RideEngine) {
    return workoutPowerCeiling(engine.session.workout, engine.session.ftp!);
  }
}
