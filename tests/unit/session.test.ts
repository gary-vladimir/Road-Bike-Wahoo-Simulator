import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ergBehavior, setControlGate } from '../../src/trainer/session';
import {
  fakeTrainer,
  grades,
  resetTrainerClock,
  run,
  useTrainerClock,
  watts,
} from '../helpers/fake-trainer';

beforeEach(useTrainerClock);
afterEach(resetTrainerClock);

describe('trainer session gating', () => {
  it('refuses to open while control is off, while hidden, or beyond its power grant', async () => {
    const f = fakeTrainer();
    setControlGate(() => false);
    await expect(f.open({ mode: 'sim' })).rejects.toThrow('Trainer control is off');
    setControlGate(() => true);
    f.doc.hidden = true;
    await expect(f.open({ mode: 'sim' })).rejects.toThrow('visible');
    f.doc.hidden = false;
    await expect(f.open({ mode: 'erg', powerCeiling: 700 })).rejects.toThrow('ceiling');
    await expect(f.open({ mode: 'erg', purpose: 'diagnostic', powerCeiling: 150 })).rejects.toThrow(
      'ceiling',
    );
    expect(f.writes).toEqual([]);
  });

  it('lets only one session control the trainer at a time', async () => {
    const f = fakeTrainer();
    const first = await f.open({ mode: 'sim' });
    await expect(f.open({ mode: 'sim' })).rejects.toThrow('Another BikeSIM tab');
    await first.release();
    const second = await f.open({ mode: 'sim' });
    await second.release();
  });
});

describe('SIM road control', () => {
  it('waits for live power (coasting is fine), then takes control on a flat road', async () => {
    const f = fakeTrainer();
    f.trainer.stale = true;
    const s = await f.open({ mode: 'sim' });
    await run(2000);
    expect(f.writes).toEqual([]);
    expect(s.state).toBe('waiting');
    f.trainer.stale = false;
    f.trainer.power = 0;
    f.trainer.cadence = 0;
    await run(250);
    expect(f.writes).toEqual([[0], [0x11, 0, 0, 0, 0, 40, 16], [7]]);
    expect(s.state).toBe('active');
    await s.release();
  });

  it('follows the road at most 0.5 points per second and clamps to the envelope', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'sim' });
    await run(250);
    s.follow(2);
    await run(4250);
    expect(grades(f.writes)).toEqual([0, 0.5, 1, 1.5, 2]);
    s.follow(40);
    expect(s.snapshot().requestedGrade).toBe(12);
    s.follow(1.25);
    await run(3000);
    expect(grades(f.writes).at(-1)).toBe(1.25);
    expect(f.writes.filter((w) => w[0] === 8)).toEqual([]);
    await s.release();
  });

  it('holds a flat road at once while paused and resumes without re-arming', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'sim' });
    await run(250);
    s.follow(3);
    await run(7000);
    expect(grades(f.writes).at(-1)).toBe(3);
    s.hold();
    await run(250);
    expect(grades(f.writes).at(-1)).toBe(0);
    expect(s.state).toBe('holding');
    const writes = f.writes.length;
    s.follow(3);
    await run(1250);
    expect(s.state).toBe('active');
    expect(f.writes.slice(writes).map((w) => w[0])).not.toContain(0);
    expect(grades(f.writes).at(-1)).toBe(0.5);
    await s.release();
  });

  it('ends on a flat road without FTMS Stop, keeping the connection and freeing the lock', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'sim' });
    await run(250);
    s.follow(2);
    await run(3000);
    await s.release();
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 0, 0, 40, 16]);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    expect(s.state).toBe('ended');
    expect(s.releaseConfirmed).toBe(true);
    expect(f.disconnect).not.toHaveBeenCalled();
    const count = f.writes.length;
    await run(5000);
    expect(f.writes).toHaveLength(count);
    await (await f.open({ mode: 'sim' })).release();
  });

  it('cancels before taking control without sending anything', async () => {
    const f = fakeTrainer();
    f.trainer.stale = true;
    const s = await f.open({ mode: 'sim' });
    await run(1000);
    await s.release();
    expect(s.state).toBe('ended');
    expect(f.writes).toEqual([]);
  });
});

describe('ERG workout control', () => {
  async function running(target: number) {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'erg', powerCeiling: 300 });
    await run(250);
    s.follow(target);
    await run(15000);
    return { f, s };
  }

  it('waits for pedaling, starts at 50 W, ramps up gradually and eases down at once', async () => {
    const f = fakeTrainer();
    f.trainer.cadence = 20;
    const s = await f.open({ mode: 'erg', powerCeiling: 300 });
    await run(3000);
    expect(f.writes).toEqual([]);
    f.trainer.cadence = 85;
    await run(250);
    expect(f.writes).toEqual([[0], [5, 50, 0], [7]]);
    s.follow(150);
    await run(4250);
    expect(watts(f.writes)).toEqual([50, 75, 100, 125, 150]);
    s.follow(90);
    await run(250);
    expect(watts(f.writes).at(-1)).toBe(90);
    await s.release();
  });

  it('rides through a brief cadence dropout without changing the load', async () => {
    const { f, s } = await running(200);
    expect(watts(f.writes).at(-1)).toBe(200);
    const count = f.writes.length;
    // The KICKR sometimes reports 0 rpm for a moment while the rider keeps pedaling.
    f.trainer.cadence = 0;
    await run(2500);
    f.trainer.cadence = 85;
    await run(5000);
    expect(f.writes).toHaveLength(count);
    expect(s.recovery).toBe(false);
    await s.release();
  });

  it('eases to 50 W after sustained low cadence and returns to the target on spin-up', async () => {
    const { f, s } = await running(200);
    f.trainer.cadence = 30;
    await run(ergBehavior.lowCadenceMs + 500);
    expect(s.recovery).toBe(true);
    expect(watts(f.writes).at(-1)).toBe(50);
    expect(s.state).toBe('active');
    f.trainer.cadence = 85;
    await run(ergBehavior.resumeMs + 500);
    expect(s.recovery).toBe(false);
    await run(8000);
    expect(watts(f.writes).at(-1)).toBe(200);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    await s.release();
  });

  it('holds 50 W at once when paused and ends on a flat road', async () => {
    const { f, s } = await running(180);
    s.hold();
    await run(250);
    expect(watts(f.writes).at(-1)).toBe(50);
    expect(s.state).toBe('holding');
    await s.release();
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 0, 0, 40, 16]);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
  });

  it('treats a frozen tab as a pause instead of a fault', async () => {
    const f = fakeTrainer();
    let skew = 0;
    const s = await f.open({ mode: 'erg', powerCeiling: 300 }, () => performance.now() + skew);
    await run(250);
    s.follow(200);
    await run(10000);
    skew += 4000;
    await run(250);
    expect(s.state).toBe('holding');
    expect(watts(f.writes).at(-1)).toBe(50);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    await s.release();
  });

  it('refuses targets outside its grant', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'erg', purpose: 'diagnostic' });
    expect(() => s.follow(150)).toThrow('authorized');
    expect(() => s.follow(NaN)).toThrow();
    s.follow(100);
    await s.release();
    expect(f.writes).toEqual([]);
  });
});

describe('faults and trainer-side changes', () => {
  it('sends FTMS Stop after a refused command and keeps telemetry once Stop is confirmed', async () => {
    const f = fakeTrainer();
    f.trainer.reject = 0x11;
    const s = await f.open({ mode: 'sim' });
    await run(250);
    expect(s.state).toBe('faulted');
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(s.stopConfirmed).toBe(true);
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.latest().message).toContain('rejected');
  });

  it('drops an unacknowledged session and says the load is unknown', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'erg', powerCeiling: 300 });
    f.trainer.silent = true;
    await run(250);
    await run(6000);
    expect(s.state).toBe('faulted');
    expect(s.message).toContain('unknown');
    expect(f.disconnect).toHaveBeenCalled();
  });

  it('ends without Stop when the trainer reports lost control', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'sim' });
    await run(250);
    f.status(0xff);
    await run(0);
    expect(s.state).toBe('ended');
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    await (await f.open({ mode: 'sim' })).release();
  });

  it('faults on a Bluetooth disconnect with an unknown load', async () => {
    const f = fakeTrainer();
    const s = await f.open({ mode: 'sim' });
    await run(250);
    f.device.dispatchEvent(new Event('gattserverdisconnected'));
    await run(0);
    expect(s.state).toBe('faulted');
    expect(s.message).toContain('unknown');
  });
});
