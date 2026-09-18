import { describe, it, expect } from 'vitest';
import { presets } from '../../src/workouts/model';
import {
  workoutControlIssue,
  workoutPowerCeiling,
  workoutTarget,
} from '../../src/ride/workout-control';
import { encodeControl } from '../../src/trainer/control';
import { RideEngine } from '../../src/ride/engine';
import { routes } from '../../src/ride/terrain';

describe('workout power authorization', () => {
  it('validates the complete intensity envelope and keeps unsupported workouts read-only', () => {
    presets.forEach((w) => expect(workoutControlIssue(w, 200)).toBeNull());
    expect(workoutControlIssue(presets[0], null)).toContain('known FTP');
    expect(workoutControlIssue(presets[0], 50)).toContain('40–600');
    expect(
      workoutControlIssue(
        { ...presets[0], blocks: [{ ...presets[0].blocks[0], cadence: 40 }] },
        200,
      ),
    ).toContain('at least 50 rpm');
    const hard = { ...presets[0], blocks: [{ ...presets[0].blocks[0], from: 1.2, to: 1.2 }] };
    expect(workoutControlIssue(hard, 500)).toContain('40–600');
    expect(() => new RideEngine(hard, 'bluetooth', 500, 70, { trainerControl: 'erg' })).toThrow();
    expect(() => new RideEngine(presets[0], 'demo', 200, 70, { trainerControl: 'erg' })).toThrow();
    expect(
      () =>
        new RideEngine(presets[0], 'bluetooth', 200, 70, {
          trainerControl: 'erg',
          route: routes[0],
        }),
    ).toThrow();
  });
  it('uses linear targets and a workout-specific ceiling including 110% intensity', () => {
    const w = {
      ...presets[0],
      blocks: [{ ...presets[0].blocks[0], seconds: 60, from: 0.5, to: 1 }],
    };
    expect(workoutTarget(w, 200, 30, 1)).toBe(150);
    expect(workoutTarget(w, 200, 30, 0.8)).toBe(120);
    expect(workoutPowerCeiling(w, 200)).toBe(220);
  });
  it('requires a workout grant for higher power and never exceeds that grant', () => {
    const limits = { min: 0, max: 2000, increment: 1, ceiling: 220 };
    expect(() => encodeControl({ kind: 'power', watts: 200 }, limits)).toThrow();
    expect([
      ...encodeControl({ kind: 'power', watts: 200 }, { ...limits, powerMode: 'workout' }),
    ]).toEqual([5, 200, 0]);
    for (const watts of [39, 221, NaN])
      expect(() =>
        encodeControl({ kind: 'power', watts }, { ...limits, powerMode: 'workout' }),
      ).toThrow();
    expect(() =>
      encodeControl(
        { kind: 'power', watts: 601 },
        { ...limits, ceiling: 601, powerMode: 'workout' },
      ),
    ).toThrow();
  });
});
