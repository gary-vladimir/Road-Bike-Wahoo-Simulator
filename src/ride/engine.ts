import { position, totalSeconds, validateWorkout, type Workout } from '../workouts/model';
import type { Telemetry } from '../trainer/ftms';
import { advanceRoad, routeLength, routePosition, validateRoute, type Route } from './terrain';
import { stockWheel, validateWheel, type WheelSetup } from './bike';
import { supportsRoadControl } from './road-control';
export type Source = 'demo' | 'bluetooth';
export type Phase = 'countdown' | 'running' | 'paused' | 'finished';
export type Sample = {
  /** UTC milliseconds, anchored to the monotonic ride clock. Absent on older rides. */
  timestamp?: number;
  elapsed: number;
  power: number;
  cadence?: number;
  target: number;
  speed: number;
  distance: number;
  grade: number;
};
export type RideState = {
  phase: Phase;
  elapsed: number;
  countdown: number;
  power?: number;
  cadence?: number;
  speed: number;
  distance: number;
  target: number;
  grade: number;
  reason: string;
  bias: number;
};
export type Session = {
  id: string;
  workout: Workout;
  startedAt: string;
  timerEvents?: { timestamp: number; elapsed: number; type: 'start' | 'stop' }[];
  recordedAt?: number;
  source: Source;
  ftp: number | null;
  mass: number;
  bikeMass?: number;
  wheel?: WheelSetup;
  physicsVersion?: number;
  mode?: 'sim' | 'erg';
  trainerControl?: 'sim';
  route?: Route;
  elapsed: number;
  distance: number;
  status: 'in-progress' | 'completed' | 'stopped' | 'interrupted';
  samples: Sample[];
  events: { elapsed: number; message: string }[];
};
/** Fixed maximum time step prevents suspension from replaying missed workout commands. */
export class RideEngine {
  state: RideState = {
    phase: 'countdown',
    elapsed: 0,
    countdown: 10,
    speed: 0,
    distance: 0,
    target: 0,
    grade: 0,
    reason: '',
    bias: 1,
  };
  session: Session;
  private last?: number;
  private wallOrigin?: number;
  private timerRunning = false;
  private sampleElapsed = 0;
  private demoPower = 0;
  demoEffort = 100;
  constructor(
    workout: Workout,
    source: Source,
    ftp: number | null,
    mass: number,
    options?: { route?: Route; bikeMass?: number; wheel?: WheelSetup; trainerControl?: 'sim' },
  ) {
    validateWorkout(workout);
    if (
      (ftp === null ? !options?.route : !Number.isFinite(ftp) || ftp < 50 || ftp > 600) ||
      !Number.isFinite(mass) ||
      mass < 35 ||
      mass > 200
    )
      throw new Error('Enter FTP between 50–600 W and rider mass between 35–200 kg.');
    if (options?.route) validateRoute(options.route);
    if (
      options?.trainerControl &&
      (source !== 'bluetooth' || !options.route || !supportsRoadControl(options.route))
    )
      throw new Error('This road is outside the supported trainer-control range (−4% to +5%).');
    const bikeMass = options?.bikeMass ?? 9;
    validateWheel(options?.wheel ?? stockWheel);
    if (!Number.isFinite(bikeMass) || bikeMass < 4 || bikeMass > 30)
      throw new Error('Bike mass must be 4–30 kg');
    this.session = {
      id: crypto.randomUUID(),
      workout: structuredClone(workout),
      source,
      ftp,
      mass,
      bikeMass,
      wheel: structuredClone(options?.wheel ?? stockWheel),
      physicsVersion: 2,
      mode: options?.route ? 'sim' : 'erg',
      trainerControl: options?.trainerControl,
      route: options?.route ? structuredClone(options.route) : undefined,
      startedAt: new Date().toISOString(),
      timerEvents: [],
      elapsed: 0,
      distance: 0,
      status: 'in-progress',
      samples: [],
      events: [],
    };
  }
  tick(now: number, telemetry?: Telemetry) {
    if (this.last === undefined) {
      this.wallOrigin ??= Date.now() - now;
      this.last = now;
      return;
    }
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0 || dt > 2.5) {
      this.pause('Timing interrupted. Resume when ready.');
      return;
    }
    if (this.state.phase === 'paused' || this.state.phase === 'finished') return;
    if (
      this.session.source === 'bluetooth' &&
      (telemetry?.power === undefined ||
        !Number.isFinite(telemetry.power) ||
        telemetry.powerAt === undefined ||
        !Number.isFinite(telemetry.powerAt) ||
        telemetry.powerAt > now ||
        now - telemetry.powerAt > 3000)
    ) {
      this.pause('Live power is stale. Check the trainer connection.');
      return;
    }
    if (this.state.phase === 'countdown') {
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown === 0) {
        this.state.phase = 'running';
        this.session.recordedAt = this.wallOrigin! + now;
        this.timerRunning = true;
        this.session.timerEvents!.push({
          timestamp: this.session.recordedAt,
          elapsed: this.state.elapsed,
          type: 'start',
        });
      }
      return;
    }
    const remaining = totalSeconds(this.session.workout) - this.state.elapsed;
    const step = Math.min(dt, remaining);
    this.state.elapsed += step;
    const current = position(this.session.workout, this.state.elapsed);
    this.state.target = this.session.route
      ? 0
      : Math.round(current.target * (this.session.ftp ?? 0) * this.state.bias);
    if (this.session.route)
      this.state.grade = routePosition(this.session.route, this.state.distance * 1000).grade;
    else this.state.grade += (current.block.grade - this.state.grade) * (1 - Math.exp(-step / 3));
    if (this.session.source === 'demo') {
      this.demoPower +=
        ((this.session.route ? this.demoEffort : this.state.target) - this.demoPower) *
        (1 - Math.exp(-step / 2));
      this.state.power = Math.max(
        0,
        Math.round(this.demoPower + Math.sin(this.state.elapsed * 0.7) * 3),
      );
      if (this.session.route && this.demoEffort === 0) this.state.power = 0;
      this.state.cadence = this.session.route
        ? this.demoEffort === 0
          ? 0
          : 80
        : Math.round(current.block.cadence + Math.sin(this.state.elapsed / 3) * 2);
    } else {
      this.state.power = telemetry!.power;
      this.state.cadence =
        Number.isFinite(telemetry!.cadence) &&
        telemetry!.cadenceAt !== undefined &&
        now >= telemetry!.cadenceAt &&
        now - telemetry!.cadenceAt < 3000
          ? telemetry!.cadence
          : undefined;
    }
    // Sample the terrain along the path, including during a long (but valid) timer step.
    const motionSteps = Math.max(1, Math.ceil(step / 0.05));
    for (let i = 0; i < motionSteps; i++) {
      const grade = this.session.route
        ? routePosition(this.session.route, this.state.distance * 1000).grade
        : this.state.grade;
      const motion = advanceRoad(
        this.state.speed,
        this.state.power ?? 0,
        grade,
        this.session.mass,
        this.session.bikeMass ?? 9,
        step / motionSteps,
      );
      this.state.speed = motion.speed;
      this.state.distance += motion.distance;
    }
    if (this.session.route) {
      this.state.distance = Math.min(routeLength(this.session.route) / 1000, this.state.distance);
      this.state.grade = routePosition(this.session.route, this.state.distance * 1000).grade;
    }
    this.sampleElapsed += step;
    this.session.recordedAt = this.wallOrigin! + now - (dt - step) * 1000;
    if (this.sampleElapsed >= 1) {
      this.recordSample();
      this.sampleElapsed %= 1;
    }
    this.session.elapsed = this.state.elapsed;
    this.session.distance = this.state.distance;
    if (this.session.route && this.state.distance * 1000 >= routeLength(this.session.route))
      this.finish(true);
    else if (this.state.elapsed >= totalSeconds(this.session.workout))
      this.finish(!this.session.route);
  }
  pause(reason = 'Paused. Your place is saved.') {
    if (this.state.phase === 'finished' || this.state.phase === 'paused') return;
    this.stopTimer();
    this.state.phase = 'paused';
    this.state.reason = reason;
    this.state.speed = 0;
    this.session.events.push({ elapsed: this.state.elapsed, message: reason });
  }
  resume() {
    if (this.state.phase !== 'paused') return;
    this.state.phase = 'countdown';
    this.state.countdown = 3;
    this.state.reason = '';
    this.demoPower = 0;
    this.last = undefined;
    this.session.events.push({ elapsed: this.state.elapsed, message: 'Resumed with countdown' });
  }
  setBias(value: number) {
    if (!Number.isFinite(value)) return;
    this.state.bias = Math.max(0.8, Math.min(1.1, Math.round(value * 100) / 100));
    this.session.events.push({
      elapsed: this.state.elapsed,
      message: `Intensity ${Math.round(this.state.bias * 100)}%`,
    });
  }
  setDemoEffort(watts: number) {
    if (this.session.source !== 'demo' || !this.session.route || !Number.isFinite(watts)) return;
    this.demoEffort = Math.max(0, Math.min(400, Math.round(watts)));
  }
  finish(completed = false) {
    if (this.state.phase === 'finished') return;
    this.stopTimer();
    this.state.phase = 'finished';
    this.state.speed = 0;
    this.session.status = completed ? 'completed' : 'stopped';
    this.session.events.push({
      elapsed: this.state.elapsed,
      message: completed
        ? this.session.route
          ? 'Route completed'
          : 'Workout completed'
        : 'Ride ended',
    });
  }
  private recordSample() {
    if (this.state.elapsed <= (this.session.samples.at(-1)?.elapsed ?? 0)) return;
    this.session.samples.push({
      timestamp: this.session.recordedAt,
      elapsed: this.state.elapsed,
      power: this.state.power ?? 0,
      cadence: this.state.cadence,
      target: this.state.target,
      speed: this.state.speed,
      distance: this.state.distance,
      grade: this.state.grade,
    });
  }
  private stopTimer() {
    if (!this.timerRunning) return;
    // Capture the final fraction of a second before pause/finish clears the displayed speed.
    this.recordSample();
    this.session.timerEvents!.push({
      timestamp: this.session.recordedAt!,
      elapsed: this.state.elapsed,
      type: 'stop',
    });
    this.timerRunning = false;
  }
}
