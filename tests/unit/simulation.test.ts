import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlQueue, encodeControl, type ControlCommand } from '../../src/trainer/control';
import { SimulationSupervisor } from '../../src/safety/simulation';
const limits = {
  min: 0,
  max: 2000,
  increment: 1,
  ceiling: 100,
  simulation: { minGrade: -6, maxGrade: 6 },
};
const sim = (grade: number): ControlCommand => ({
  kind: 'simulation',
  grade,
  windSpeed: 0,
  rollingResistance: 0.004,
  windResistance: 0.18,
});
function fixture() {
  let now = 1000,
    fresh = true,
    callback: (v: DataView) => void = () => {};
  const writes: number[][] = [];
  const queue = new ControlQueue(
    {
      subscribe: (fn) => {
        callback = fn;
        return () => {};
      },
      write: async (bytes) => {
        writes.push([...bytes]);
        callback(new DataView(Uint8Array.of(0x80, bytes[0], 1).buffer));
      },
    },
    limits,
  );
  const controller = new SimulationSupervisor(
    queue,
    limits,
    () => ({ power: 0, cadence: 0, powerAt: fresh ? now : now - 3000, receivedAt: now }),
    () => now,
  );
  return {
    controller,
    queue,
    writes,
    advance: (ms: number) => {
      now += ms;
    },
    stale: () => {
      fresh = false;
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('SIM protocol and controller — synthetic wire only', () => {
  it('encodes signed little-endian grade/wind and coefficient units correctly', () => {
    expect([...encodeControl(sim(-1.5), limits)]).toEqual([0x11, 0, 0, 0x6a, 0xff, 40, 18]);
    expect([...encodeControl({ ...sim(2), windSpeed: -1.25 } as ControlCommand, limits)]).toEqual([
      0x11, 0x1e, 0xfb, 200, 0, 40, 18,
    ]);
    expect(() => encodeControl(sim(1), { ...limits, simulation: undefined })).toThrow(
      'not authorized',
    );
    for (const grade of [NaN, Infinity, -6.1, 6.1])
      expect(() => encodeControl(sim(grade), limits)).toThrow();
  });
  it('requires explicit baseline/profile evidence before any command', async () => {
    const f = fixture();
    await expect(
      f.controller.arm({ baselineConfirmed: false, trainerProfileConfirmed: true }),
    ).rejects.toThrow('baseline');
    await expect(
      f.controller.arm({ baselineConfirmed: true, trainerProfileConfirmed: false }),
    ).rejects.toThrow('profile');
    expect(f.writes).toEqual([]);
    f.queue.close();
  });
  it('uses SIM only, ramps at 0.25 percentage points per second, and allows coasting', async () => {
    const f = fixture();
    await f.controller.arm({ baselineConfirmed: true, trainerProfileConfirmed: true });
    expect(f.controller.state).toBe('running');
    // Oaxaca-altitude hoods drag: Cw 0.16 kg/m; rolling 0.004.
    expect(f.writes).toEqual([[0], [0x11, 0, 0, 0, 0, 40, 16], [7]]);
    f.advance(1000);
    await f.controller.update(4);
    expect(f.controller.grade).toBe(0.25);
    f.advance(500);
    await f.controller.update(4);
    expect(f.controller.grade).toBe(0.25);
    f.advance(500);
    await f.controller.update(-2);
    expect(f.controller.grade).toBe(0);
    expect(f.writes.every((w) => w[0] !== 5)).toBe(true);
    await f.controller.stop();
    expect(f.writes.at(-1)).toEqual([8, 1]);
    const count = f.writes.length;
    await f.controller.update(2);
    expect(f.writes).toHaveLength(count);
    await expect(
      f.controller.arm({ baselineConfirmed: true, trainerProfileConfirmed: true }),
    ).rejects.toThrow('new SIM session');
    f.queue.close();
  });
  it('stops on stale telemetry, timing gaps, and out-of-range terrain without issuing the requested slope', async () => {
    for (const fault of ['stale', 'timing', 'grade']) {
      const f = fixture();
      await f.controller.arm({ baselineConfirmed: true, trainerProfileConfirmed: true });
      if (fault === 'stale') f.stale();
      if (fault === 'timing') f.advance(5000);
      await f.controller.update(fault === 'grade' ? 10 : 1);
      expect(f.controller.state).toBe('faulted');
      expect(f.writes).toHaveLength(4);
      expect(f.writes.at(-1)).toEqual([8, 1]);
      f.queue.close();
    }
  });
});
