import { describe, expect, it } from 'vitest';
import { analyzeSession } from '../../src/ride/analysis';
import { RideEngine } from '../../src/ride/engine';
import { routes, routeWorkout } from '../../src/ride/terrain';
import { clock, presets, workoutLoad, zones } from '../../src/workouts/model';

function ride(watts: (t: number) => number, seconds: number, ftp: number | null = 200) {
  const w = presets.find((x) => x.id === 'endurance')!;
  const e = ftp
    ? new RideEngine(w, 'bluetooth', ftp, 70)
    : new RideEngine(routeWorkout(routes[0]), 'bluetooth', null, 70, { route: routes[0] });
  for (let t = 0; t <= (seconds + 10) * 1000; t += 100)
    e.tick(t, { power: watts(t / 1000), powerAt: t, cadence: 85, cadenceAt: t, receivedAt: t });
  return analyzeSession(e.session);
}

describe('ride analysis', () => {
  it('matches average power, work and zones for a steady ride', () => {
    const a = ride(() => 150, 600);
    expect(a.averagePower).toBeCloseTo(150, 0);
    expect(a.normalizedPower).toBeCloseTo(150, 0);
    expect(a.work).toBeCloseTo(90, 0);
    expect(a.intensity).toBeCloseTo(0.75, 2);
    // 10 minutes at IF 0.75 → 9.4 TSS.
    expect(a.stress).toBeCloseTo((600 / 3600) * 0.75 ** 2 * 100, 0);
    expect(a.zoneSeconds![zones.findIndex((z) => z.id === 'Z2')]).toBeGreaterThan(590);
    expect(a.averageCadence).toBeCloseTo(85, 0);
  });

  it('weights surges above the average in normalized power', () => {
    const a = ride((t) => (Math.floor(t / 30) % 2 ? 300 : 100), 1200);
    expect(a.averagePower).toBeCloseTo(200, -1);
    expect(a.normalizedPower).toBeGreaterThan(a.averagePower + 15);
  });

  it('reports climbing on roads and leaves FTP metrics empty without an FTP', () => {
    const a = ride(() => 200, 300, null);
    expect(a.climbed).toBeGreaterThanOrEqual(0);
    expect(a.intensity).toBeUndefined();
    expect(a.zoneSeconds).toBeUndefined();
    expect(a.km).toBeGreaterThan(1);
  });

  it('estimates planned workout load and formats long clocks', () => {
    const hour = presets.find((w) => w.id === 'endurance')!;
    const load = workoutLoad(hour);
    expect(load.intensity).toBeGreaterThan(0.6);
    expect(load.intensity).toBeLessThan(0.66);
    expect(load.stress).toBeGreaterThan(35);
    expect(load.stress).toBeLessThan(45);
    expect(clock(59)).toBe('0:59');
    expect(clock(3725)).toBe('1:02:05');
  });

  it('keeps every preset valid for automatic ERG at a typical FTP', async () => {
    const { workoutControlIssue } = await import('../../src/ride/workout-control');
    for (const w of presets) expect(workoutControlIssue(w, 200)).toBeNull();
    expect(new Set(presets.map((w) => w.id)).size).toBe(presets.length);
  });
});
