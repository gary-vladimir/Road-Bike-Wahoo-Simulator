import { describe, expect, it } from 'vitest';
import { RideEngine } from '../../src/ride/engine';
import { position, presets, totalSeconds, validateWorkout } from '../../src/workouts/model';
const quick = presets.find((w) => w.id === 'quick')!;
function advance(engine: RideEngine, start: number, seconds: number) {
  for (let t = start; t <= start + seconds * 1000; t += 100) engine.tick(t);
}
describe('workout timing and independent ride simulation', () => {
  it('validates every preset and resolves exact block boundaries', () => {
    presets.forEach((w) => {
      expect(() => validateWorkout(w)).not.toThrow();
      expect(totalSeconds(w)).toBeGreaterThan(0);
    });
    expect(position(quick, 60).index).toBe(1);
    expect(position(quick, 60).progress).toBe(0);
    expect(position(quick, 300).remaining).toBe(0);
  });
  it('interpolates ramps without using frame count', () => {
    expect(position(quick, 30).target).toBeCloseTo(0.525);
  });
  it('rejects invalid numbers and unbounded workouts', () => {
    const invalid = structuredClone(quick);
    invalid.blocks[0].seconds = NaN;
    expect(() => validateWorkout(invalid)).toThrow();
    expect(() => new RideEngine(quick, 'demo', NaN, 75)).toThrow();
  });
  it('counts down before progressing, then completes and records a full ride', () => {
    const e = new RideEngine(quick, 'demo', 200, 75);
    advance(e, 0, 9);
    expect(e.state.phase).toBe('countdown');
    expect(e.state.elapsed).toBe(0);
    advance(e, 9100, 302);
    expect(e.state.phase).toBe('finished');
    expect(e.session.status).toBe('completed');
    expect(e.session.elapsed).toBe(300);
    expect(e.session.samples.length).toBeGreaterThan(295);
    expect(e.state.distance).toBeGreaterThan(0.1);
  });
  it('freezes elapsed time on pause and resumes through a countdown', () => {
    const e = new RideEngine(quick, 'demo', 200, 75);
    advance(e, 0, 30);
    e.pause();
    const elapsed = e.state.elapsed;
    advance(e, 30100, 10);
    expect(e.state.elapsed).toBe(elapsed);
    e.resume();
    advance(e, 41000, 2);
    expect(e.state.elapsed).toBe(elapsed);
    expect(e.state.phase).toBe('countdown');
  });
  it('pauses instead of replaying missed intervals after suspension', () => {
    const e = new RideEngine(quick, 'demo', 200, 75);
    advance(e, 0, 30);
    const elapsed = e.state.elapsed;
    e.tick(120000);
    expect(e.state.phase).toBe('paused');
    expect(e.state.elapsed).toBe(elapsed);
    expect(e.state.reason).toContain('Timing');
  });
  it('requires fresh power specifically, not just a fresh cadence packet', () => {
    const e = new RideEngine(quick, 'bluetooth', 200, 75);
    e.tick(0);
    e.tick(400, { power: 120, powerAt: -5000, receivedAt: 400, cadence: 90, cadenceAt: 400 });
    expect(e.state.phase).toBe('paused');
    expect(e.state.reason).toContain('stale');
  });
  it('never fills missing live cadence from demo data', () => {
    const e = new RideEngine(quick, 'bluetooth', 200, 75);
    for (let t = 0; t < 15000; t += 100) e.tick(t, { power: 80, powerAt: t, receivedAt: t });
    expect(e.state.power).toBe(80);
    expect(e.state.cadence).toBeUndefined();
  });
  it('clamps intensity and snapshots the workout', () => {
    const w = structuredClone(quick),
      e = new RideEngine(w, 'demo', 200, 75);
    e.setBias(20);
    expect(e.state.bias).toBe(1.1);
    e.setBias(0.01);
    expect(e.state.bias).toBe(0.8);
    w.blocks[0].seconds = 500;
    expect(e.session.workout.blocks[0].seconds).toBe(60);
  });
  it('survives a six-hour mock soak with finite bounded motion', () => {
    const w = {
      ...structuredClone(quick),
      blocks: [
        { ...quick.blocks[1], seconds: 18000 },
        { ...quick.blocks[2], seconds: 3600 },
      ],
    };
    const e = new RideEngine(w, 'demo', 200, 75);
    advance(e, 0, 21612);
    expect(e.session.status).toBe('completed');
    expect(e.session.elapsed).toBe(21600);
    expect(Number.isFinite(e.state.distance)).toBe(true);
    expect(e.state.distance).toBeGreaterThan(50);
    expect(e.session.samples.length).toBeLessThanOrEqual(21600);
  });
});
