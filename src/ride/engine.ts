import { position, totalSeconds, validateWorkout, type Workout } from '../workouts/model';
import type { Telemetry } from '../trainer/ftms';
export type Source = 'demo' | 'bluetooth';
export type Phase = 'countdown' | 'running' | 'paused' | 'finished';
export type Sample = {
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
  source: Source;
  ftp: number;
  mass: number;
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
  private sampleElapsed = 0;
  private demoPower = 0;
  constructor(workout: Workout, source: Source, ftp: number, mass: number) {
    validateWorkout(workout);
    if (
      !Number.isFinite(ftp) ||
      ftp < 50 ||
      ftp > 600 ||
      !Number.isFinite(mass) ||
      mass < 35 ||
      mass > 200
    )
      throw new Error('Enter FTP between 50–600 W and rider mass between 35–200 kg.');
    this.session = {
      id: crypto.randomUUID(),
      workout: structuredClone(workout),
      source,
      ftp,
      mass,
      startedAt: new Date().toISOString(),
      elapsed: 0,
      distance: 0,
      status: 'in-progress',
      samples: [],
      events: [],
    };
  }
  tick(now: number, telemetry?: Telemetry) {
    if (this.last === undefined) {
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
        telemetry.powerAt === undefined ||
        now - telemetry.powerAt > 3000)
    ) {
      this.pause('Live power is stale. Check the trainer connection.');
      return;
    }
    if (this.state.phase === 'countdown') {
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown === 0) this.state.phase = 'running';
      return;
    }
    const remaining = totalSeconds(this.session.workout) - this.state.elapsed;
    const step = Math.min(dt, remaining);
    this.state.elapsed += step;
    const current = position(this.session.workout, this.state.elapsed);
    this.state.target = Math.round(current.target * this.session.ftp * this.state.bias);
    this.state.grade += (current.block.grade - this.state.grade) * (1 - Math.exp(-step / 3));
    if (this.session.source === 'demo') {
      this.demoPower += (this.state.target - this.demoPower) * (1 - Math.exp(-step / 2));
      this.state.power = Math.max(
        0,
        Math.round(this.demoPower + Math.sin(this.state.elapsed * 0.7) * 3),
      );
      this.state.cadence = Math.round(current.block.cadence + Math.sin(this.state.elapsed / 3) * 2);
    } else {
      this.state.power = telemetry!.power;
      this.state.cadence =
        telemetry!.cadenceAt !== undefined && now - telemetry!.cadenceAt < 3000
          ? telemetry!.cadence
          : undefined;
    }
    const v = this.state.speed / 3.6,
      mass = this.session.mass + 9;
    const resistance = mass * 9.81 * (0.004 + this.state.grade / 100) + 0.5 * 1.1 * 0.32 * v * v;
    const force = (Math.max(0, this.state.power ?? 0) * 0.97) / Math.max(v, 2);
    const nextV = Math.min(25, Math.max(0, v + ((force - resistance) / mass) * step));
    this.state.speed = nextV * 3.6;
    this.state.distance += ((v + nextV) * 0.5 * step) / 1000;
    this.sampleElapsed += step;
    if (this.sampleElapsed >= 1) {
      this.session.samples.push({
        elapsed: this.state.elapsed,
        power: this.state.power ?? 0,
        cadence: this.state.cadence,
        target: this.state.target,
        speed: this.state.speed,
        distance: this.state.distance,
        grade: this.state.grade,
      });
      this.sampleElapsed %= 1;
    }
    this.session.elapsed = this.state.elapsed;
    this.session.distance = this.state.distance;
    if (this.state.elapsed >= totalSeconds(this.session.workout)) this.finish(true);
  }
  pause(reason = 'Paused. Your place is saved.') {
    if (this.state.phase === 'finished' || this.state.phase === 'paused') return;
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
  finish(completed = false) {
    if (this.state.phase === 'finished') return;
    this.state.phase = 'finished';
    this.state.speed = 0;
    this.session.status = completed ? 'completed' : 'stopped';
    this.session.events.push({
      elapsed: this.state.elapsed,
      message: completed ? 'Workout completed' : 'Ride ended',
    });
  }
}
