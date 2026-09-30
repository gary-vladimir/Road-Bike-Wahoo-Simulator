import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  estimateFtp,
  ftpTarget,
  ftpDuration,
  validateFtpAssessment,
  type FtpReading,
} from '../../src/ride/ftp-test';
import { FtpControl } from '../../src/ride/ftp-control';
import { TrainerSession } from '../../src/trainer/session';
import { lastPowerAcknowledgement } from '../../src/trainer/evidence';
import {
  fakeTrainer,
  resetTrainerClock,
  run,
  useTrainerClock,
  watts,
} from '../helpers/fake-trainer';

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
    expect([0, 299, 300, 360].map((t) => ftpTarget('gentle', t, 75))).toEqual([75, 75, 80, 90]);
    expect([0, 299, 300, 360].map((t) => ftpTarget('gentle', t, 100))).toEqual([
      100, 100, 100, 110,
    ]);
    expect(ftpTarget('standard', 0, 75)).toBe(75);
    expect(ftpTarget('standard', 300, 75)).toBe(100);
    expect(ftpDuration('gentle', 75)).toBe(1680);
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
  it('keeps a best minute that contains a spurious 0 rpm reading', () => {
    const r = ftpReadings(750);
    r[700].cadence = 0;
    expect(estimateFtp(r).ftp).toBe(estimateFtp(ftpReadings(750)).ftp);
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

function setup(protocol: 'gentle' | 'standard' = 'gentle') {
  const f = fakeTrainer();
  const control = new FtpControl(
    protocol,
    (changed) =>
      TrainerSession.open(
        f.source,
        { mode: 'erg', powerCeiling: protocol === 'gentle' ? 300 : 600 },
        changed,
      ),
    () => {},
    () => performance.now(),
    50,
    () => f.source.telemetry(),
  );
  /** The FTP page's 250 ms loop, with a trainer whose measured power follows its ERG target. */
  const ride = async (seconds: number) => {
    for (let t = 0; t < seconds * 1000; t += 250) {
      const ack = control.snapshot && lastPowerAcknowledgement(control.snapshot);
      if (ack && f.trainer.cadence >= 50) f.trainer.power = ack.watts;
      control.tick(f.source.telemetry());
      await run(250);
    }
  };
  return { f, control, ride };
}
beforeEach(useTrainerClock);
afterEach(resetTrainerClock);
describe('FTP assessment on a synthetic trainer', () => {
  it('waits for pedaling and pauses the warm-up clock at a light load while you stop', async () => {
    const { f, control, ride } = setup();
    f.trainer.cadence = 0;
    await control.start();
    await ride(5);
    expect(control.phase).toBe('waiting');
    expect(f.writes).toEqual([]);
    f.trainer.cadence = 85;
    await ride(120);
    expect(control.phase).toBe('running');
    const warm = control.report.elapsed;
    expect(warm).toBeGreaterThan(115);
    f.trainer.cadence = 0;
    f.trainer.power = 0;
    await ride(60);
    expect(control.warmupPaused).toBe(true);
    expect(control.report.elapsed).toBeLessThan(warm + 4);
    expect(watts(f.writes).at(-1)).toBe(50);
    f.trainer.cadence = 85;
    await ride(10);
    expect(control.warmupPaused).toBe(false);
    expect(control.report.elapsed).toBeGreaterThan(warm + 5);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    await control.finish('cancel');
    expect(control.report.status).toBe('cancelled');
  });
  it('ignores brief cadence glitches and finishes with a result when cadence stays low', async () => {
    const { f, control, ride } = setup();
    await control.start();
    await ride(300 + 8 * 60);
    // A one-second 0 rpm glitch mid-ramp changes nothing.
    f.trainer.cadence = 0;
    await ride(1);
    f.trainer.cadence = 85;
    await ride(30);
    expect(control.phase).toBe('running');
    // The rider can no longer turn the pedals over.
    f.trainer.cadence = 20;
    await ride(6);
    expect(control.phase).toBe('finished');
    expect(control.report.status).toBe('estimated');
    // Best minute ≈ 120–130 W on the gentle ramp: FTP ≈ 75% of that.
    expect(control.report.ftp).toBeGreaterThanOrEqual(88);
    expect(control.report.ftp).toBeLessThanOrEqual(98);
    expect(control.report.stopConfirmed).toBe(true);
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 0, 0, 40, 16]);
    expect(f.writes.some((w) => w[0] === 8)).toBe(false);
    expect(() => validateFtpAssessment(control.report)).not.toThrow();
  });
  it('computes a result when the rider declares their limit', async () => {
    const { control, ride } = setup();
    await control.start();
    await ride(300 + 6 * 60);
    await control.finish('effort');
    expect(control.report.status).toBe('estimated');
    expect(() => validateFtpAssessment(control.report)).not.toThrow();
  });
  it('never sets FTP after a cancel, a short ramp, lost control or the protocol ceiling', async () => {
    const cancel = setup();
    await cancel.control.start();
    await cancel.ride(400);
    await cancel.control.finish('cancel');
    expect(cancel.control.report.status).toBe('cancelled');
    expect(cancel.control.report.ftp).toBeUndefined();

    const short = setup();
    await short.control.start();
    await short.ride(300 + 60);
    await short.control.finish('effort');
    expect(short.control.report.status).toBe('invalid');
    expect(short.control.report.ftp).toBeUndefined();

    const lost = setup();
    await lost.control.start();
    await lost.ride(400);
    lost.f.status(0xff);
    await lost.ride(1);
    expect(lost.control.phase).toBe('finished');
    expect(lost.control.report.status).toBe('invalid');
    expect(lost.control.report.ftp).toBeUndefined();

    const top = setup();
    await top.control.start();
    await top.ride(1870);
    expect(top.control.report.status).toBe('invalid');
    expect(top.control.report.ftp).toBeUndefined();
  });
});
