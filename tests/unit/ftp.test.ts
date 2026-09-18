import { describe, expect, it } from 'vitest';
import {
  estimateFtp,
  ftpTarget,
  ftpDuration,
  validateFtpAssessment,
  type FtpReading,
} from '../../src/ride/ftp-test';
import { FtpControl } from '../../src/ride/ftp-control';
import type { PilotSnapshot } from '../../src/trainer/pilot';

export function ftpReadings(until = 720): FtpReading[] {
  return Array.from({ length: until }, (_, i) => ({
    start: i,
    end: i + 1,
    power: ftpTarget('gentle', i),
    target: ftpTarget('gentle', i),
    acknowledged: ftpTarget('gentle', i),
    cadence: 80,
  }));
}
describe('FTP assessment evidence', () => {
  it('uses absolute steps without an existing FTP, including hard ceilings', () => {
    expect([0, 299, 300, 359, 360].map((t) => ftpTarget('gentle', t))).toEqual([
      50, 50, 50, 50, 60,
    ]);
    expect([299, 300, 360].map((t) => ftpTarget('standard', t))).toEqual([50, 100, 120]);
    expect(ftpTarget('standard', 10000)).toBe(600);
    expect(ftpDuration('gentle')).toBe(1860);
  });
  it('uses actual measured time-weighted power, includes partial stages and excludes warmup spikes', () => {
    const r = ftpReadings(750);
    r.forEach((s) => {
      s.power = s.start < 300 ? 1000 : s.target * 0.96;
    });
    // Final minute: half at 110 W and half at 120 W, each measured 4% lower.
    const result = estimateFtp(r);
    expect(result.bestMinute).toBeCloseTo(110.4);
    expect(result.ftp).toBe(83);
    const split = r.flatMap((s) => [
      { ...s, end: s.start + 0.2 },
      { ...s, start: s.start + 0.2 },
    ]);
    expect(estimateFtp(split).bestMinute).toBeCloseTo(110.4);
  });
  it('rejects short, missing, overshooting or unsupported evidence instead of inventing FTP', () => {
    expect(estimateFtp(ftpReadings(479)).ftp).toBeUndefined();
    expect(estimateFtp(ftpReadings().filter((s) => s.start % 20 !== 0)).ftp).toBeUndefined();
    expect(estimateFtp(ftpReadings().map((s) => ({ ...s, power: 300 }))).reason).toContain('track');
    expect(
      estimateFtp(ftpReadings().map((s) => ({ ...s, power: 50, acknowledged: 50 }))).reason,
    ).toContain('range');
  });
});

function fixture(wait = false, stopConfirmed = true) {
  let now = 0;
  let update!: (s: PilotSnapshot) => void;
  let snapshot: PilotSnapshot = {
    state: 'waiting',
    applied: 50,
    requested: 50,
    message: '',
    audit: [],
    machineStatus: [],
  };
  const targets: number[] = [];
  let stops = 0;
  const emit = (s: Partial<PilotSnapshot>) => {
    snapshot = { ...snapshot, ...s };
    update(snapshot);
  };
  const acknowledge = (watts: number) =>
    emit({
      state: 'running',
      applied: watts,
      audit: [
        { at: now, event: 'acknowledgement', bytes: [5, watts & 255, watts >> 8], result: 1 },
      ],
    });
  const control = new FtpControl(
    'gentle',
    async (changed) => {
      update = changed;
      return {
        start: async () => {
          if (!wait) acknowledge(50);
        },
        stop: async () => {
          stops++;
          emit({ state: stopConfirmed ? 'stopped' : 'faulted', stopConfirmed });
        },
        setTarget: (watts) => {
          targets.push(watts);
          acknowledge(watts);
        },
      };
    },
    () => {},
    () => now,
  );
  const tick = (power?: number, cadence = 80, delay = 1000, stale = false) => {
    now += delay;
    control.tick({
      receivedAt: now,
      power: power ?? snapshot.applied,
      cadence,
      powerAt: stale ? now - 3000 : now,
      cadenceAt: now,
    });
  };
  return { control, tick, acknowledge, emit, targets, stops: () => stops };
}
describe('FTP controller lifecycle', () => {
  it('waits for arming, records fresh measured power, stops once and returns a validated result', async () => {
    const f = fixture(true);
    await f.control.start();
    f.tick();
    expect(f.control.report.elapsed).toBe(0);
    expect(f.targets).toEqual([]);
    f.acknowledge(50);
    for (let i = 0; i < 720; i++) f.tick();
    await f.control.finish('effort');
    await f.control.finish('cancel');
    expect(f.stops()).toBe(1);
    expect(f.control.report).toMatchObject({ status: 'estimated', ftp: 83, stopConfirmed: true });
    expect(() => validateFtpAssessment(f.control.report)).not.toThrow();
    const count = f.targets.length;
    f.tick();
    expect(f.targets.length).toBe(count);
  });
  it.each(['cadence', 'stale', 'timing', 'disconnect'] as const)(
    'invalidates %s loss without a resumable result',
    async (fault) => {
      const f = fixture();
      await f.control.start();
      for (let i = 0; i < 720; i++) f.tick();
      if (fault === 'disconnect') f.emit({ state: 'faulted', message: 'Disconnected' });
      else
        f.tick(
          undefined,
          fault === 'cadence' ? 0 : 80,
          fault === 'timing' ? 3000 : 1000,
          fault === 'stale',
        );
      await f.control.finish('effort');
      expect(f.control.report.status).toBe('invalid');
      expect(f.control.report.ftp).toBeUndefined();
    },
  );
  it('does not calculate after cancellation, a ceiling, or unconfirmed Stop', async () => {
    for (const mode of ['cancel', 'ceiling', 'stop'] as const) {
      const f = fixture(false, mode !== 'stop');
      await f.control.start();
      for (let i = 0; i < (mode === 'ceiling' ? 1860 : 720); i++) f.tick();
      await f.control.finish(mode === 'cancel' ? 'cancel' : 'effort');
      expect(f.control.report.ftp).toBeUndefined();
      expect(f.control.report.status).toBe(mode === 'cancel' ? 'cancelled' : 'invalid');
    }
  });
  it('cancels delayed preparation without starting the trainer', async () => {
    let release!: () => void;
    let starts = 0,
      stops = 0;
    const c = new FtpControl(
      'gentle',
      async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return {
          start: async () => {
            starts++;
          },
          stop: async () => {
            stops++;
          },
          setTarget: () => {},
        };
      },
      () => {},
    );
    void c.start();
    const done = c.finish('cancel');
    release();
    await done;
    expect(starts).toBe(0);
    expect(stops).toBe(1);
    expect(c.report.status).toBe('cancelled');
  });
});
