import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RideEngine } from '../../src/ride/engine';
import { RideTrainer } from '../../src/ride/ride-trainer';
import { routeWorkout, type Route } from '../../src/ride/terrain';
import { TrainerSession, type SessionOptions } from '../../src/trainer/session';
import { presets } from '../../src/workouts/model';
import {
  fakeTrainer,
  grades,
  resetTrainerClock,
  run,
  useTrainerClock,
  watts,
} from '../helpers/fake-trainer';

const climb: Route = {
  id: 'test-climb',
  name: 'Test climb',
  description: 'A steady 4% road.',
  points: [
    { meters: 0, grade: 4 },
    { meters: 5000, grade: 4 },
  ],
};

function setup(kind: 'sim' | 'erg', difficulty = 1) {
  const f = fakeTrainer();
  const engine =
    kind === 'sim'
      ? new RideEngine(routeWorkout(climb), 'bluetooth', null, 70, {
          route: climb,
          trainerControl: 'sim',
        })
      : new RideEngine(
          presets.find((w) => w.id === 'quick')!,
          'bluetooth',
          200,
          70,
          {
            trainerControl: 'erg',
          },
        );
  const options: SessionOptions =
    kind === 'sim' ? { mode: 'sim' } : { mode: 'erg', powerCeiling: RideTrainer.ceiling(engine) };
  let opened = 0;
  const link = new RideTrainer(
    engine,
    (changed) => {
      opened++;
      return TrainerSession.open(f.source, options, changed);
    },
    () => {},
    difficulty,
  );
  /** The Ride screen's 100 ms loop. */
  const ride = async (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      if (link.ready) engine.tick(performance.now(), f.source.telemetry());
      link.update();
      await run(100);
    }
  };
  return { f, engine, link, ride, opened: () => opened };
}

beforeEach(useTrainerClock);
afterEach(resetTrainerClock);

describe('ride ↔ trainer link', () => {
  it('holds the countdown until the trainer is on a flat road, then follows the slope × difficulty', async () => {
    const { f, engine, link, ride } = setup('sim', 0.5);
    f.trainer.stale = true;
    void link.start();
    await ride(2000);
    expect(engine.state.phase).toBe('countdown');
    expect(engine.state.countdown).toBe(10);
    f.trainer.stale = false;
    await ride(10500);
    expect(engine.state.phase).toBe('running');
    await ride(6000);
    // 4% road at 50% difficulty: the trainer climbs to 2% in half-point steps.
    expect(grades(f.writes)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(link.snapshot?.appliedGrade).toBe(2);
    await link.finish();
  });

  it('eases to a flat road while paused and resumes on the same session', async () => {
    const { f, engine, link, ride, opened } = setup('sim');
    void link.start();
    await ride(18000);
    expect(grades(f.writes).at(-1)).toBe(4);
    engine.pause();
    link.update();
    await run(300);
    expect(grades(f.writes).at(-1)).toBe(0);
    expect(link.snapshot?.state).toBe('holding');
    engine.resume();
    link.resume();
    await ride(4000);
    expect(engine.state.phase).toBe('running');
    expect(opened()).toBe(1);
    expect(f.writes.filter((w) => w[0] === 0)).toHaveLength(1);
    engine.finish();
    link.update();
    await link.finish();
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 0, 0, 40, 16]);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
  });

  it('runs ERG targets from the workout, starting at 50 W during the countdown', async () => {
    const { f, engine, link, ride } = setup('erg');
    void link.start();
    await ride(10000);
    expect(engine.state.phase).toBe('countdown');
    expect(watts(f.writes)).toEqual([50]);
    await ride(1500);
    // The warm-up ramps up from 40% of 200 W; the trainer climbs from 50 W in ≤25 W steps.
    const early = watts(f.writes);
    expect(early[0]).toBe(50);
    early.slice(1).forEach((w, i) => expect(w - early[i]).toBeLessThanOrEqual(25));
    expect(early.at(-1)).toBeGreaterThanOrEqual(80);
    await ride(65000);
    // Quick workout: 1-minute warm-up ramp to 65%, then 60% of 200 W.
    expect(engine.state.elapsed).toBeGreaterThan(60);
    expect(watts(f.writes).at(-1)).toBe(120);
    engine.finish();
    link.update();
    await link.finish();
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 0, 0, 40, 16]);
  });

  it('pauses the ride when control is lost and re-arms a fresh session on resume', async () => {
    const { f, engine, link, ride, opened } = setup('sim');
    void link.start();
    await ride(12000);
    f.status(0xff);
    await ride(200);
    expect(engine.state.phase).toBe('paused');
    expect(link.ended).toBe(true);
    engine.resume();
    link.resume();
    await ride(12000);
    expect(opened()).toBe(2);
    expect(engine.state.phase).toBe('running');
    expect(f.writes.filter((w) => w[0] === 0)).toHaveLength(2);
    await link.finish();
  });

  it('pauses with an explanation when control is off', async () => {
    const { engine, link, ride } = setup('sim');
    const { setControlGate } = await import('../../src/trainer/session');
    setControlGate(() => false);
    void link.start();
    await ride(500);
    expect(engine.state.phase).toBe('paused');
    expect(engine.state.reason).toContain('Settings');
  });
});
