import { describe, expect, it } from 'vitest';
import {
  lastGradeAcknowledgement,
  lastPowerAcknowledgement,
  ControlEvidence,
  summarizePlateaus,
} from '../../src/trainer/evidence';
import type { SessionSnapshot } from '../../src/trainer/session';
import captured from '../fixtures/kickr-erg-2026-09-09.json';
const snapshot = (watts = 50, at = 1000): SessionSnapshot => ({
  state: 'active',
  mode: 'erg',
  recovery: false,
  appliedWatts: watts,
  requestedWatts: watts,
  stopConfirmed: false,
  releaseConfirmed: false,
  message: '',
  machineStatus: [],
  audit: [{ at, event: 'acknowledgement', bytes: [5, watts, 0], result: 1 }],
});
describe('passive ERG response evidence', () => {
  it('reads the actual KICKR acknowledgements without claiming measured target response', () => {
    const s = { ...snapshot(), ...captured, state: 'faulted' as const };
    expect(lastPowerAcknowledgement(s)?.watts).toBe(100);
    expect(
      captured.audit
        .filter((e) => e.event === 'acknowledgement' && e.bytes[0] === 5)
        .map((e) => e.bytes[1]),
    ).toEqual([50, 60, 70, 75, 85, 95, 100]);
    const stop = captured.audit.find((e) => e.event === 'write' && e.bytes[0] === 8)!;
    expect((stop.at - lastPowerAcknowledgement(s)!.at) / 1000).toBeCloseTo(6.4934, 3);
    const report = new ControlEvidence().report(s);
    expect(report.plateaus).toEqual([]);
    expect(report.samples).toEqual([]);
    expect(report.message).toContain('Cadence below');
  });
  it('separates requested targets from acknowledgements and excludes refused commands', () => {
    const s = snapshot();
    s.requestedWatts = 100;
    s.audit.push({ at: 2000, event: 'acknowledgement', bytes: [5, 100, 0], result: 4 });
    expect(lastPowerAcknowledgement(s)?.watts).toBe(50);
    const recorder = new ControlEvidence();
    recorder.record(2000, { power: 48, powerAt: 2000, receivedAt: 2000 }, s);
    expect(recorder.samples[0]).toMatchObject({ requested: 100, acknowledged: 50, power: 48 });
    expect(recorder.report(s).plateaus).toEqual([]);
  });
  it('excludes settling, stale, and duplicate sensor packets instead of filling targets as power', () => {
    const recorder = new ControlEvidence(),
      s = snapshot(100);
    for (let now = 1000; now <= 21000; now += 500) {
      const packetAt = Math.floor(now / 1000) * 1000;
      recorder.record(
        now,
        {
          receivedAt: now,
          power: now < 11000 ? 100 : 22,
          powerAt: packetAt,
          cadence: 68,
          cadenceAt: packetAt,
        },
        s,
      );
    }
    const plateau = summarizePlateaus(recorder.samples)[0];
    expect(plateau).toMatchObject({
      target: 100,
      observedSeconds: 20,
      averagePower: 22,
      averageCadence: 68,
      settledSamples: 11,
    });
    recorder.record(
      22000,
      { receivedAt: 22000, power: 100, powerAt: 1000, cadence: NaN, cadenceAt: 22000 },
      s,
    );
    expect(recorder.samples.at(-1)).toMatchObject({ power: null, cadence: null });
    expect(recorder.report(s).plateaus[0].averagePower).toBe(22);
  });
  it('keeps post-stop load separate, records the reason, and starts a new capture with a short baseline', () => {
    const recorder = new ControlEvidence(),
      s = snapshot();
    recorder.record(1000, { power: 50, powerAt: 1000, receivedAt: 1000 }, s);
    const stopped = {
      ...s,
      state: 'faulted' as const,
      message: 'Cadence below pilot minimum: 50 rpm',
    };
    recorder.record(
      2000,
      { power: 150, powerAt: 2000, cadence: 45, cadenceAt: 2000, receivedAt: 2000 },
      stopped,
    );
    expect(recorder.report(stopped).samples.at(-1)).toMatchObject({ phase: 'faulted', power: 150 });
    expect(recorder.report(stopped).plateaus[0].averagePower).toBeNull();
    recorder.begin(11500);
    expect(recorder.samples).toHaveLength(1);
    expect(recorder.samples[0]).toMatchObject({
      phase: 'faulted',
      requested: null,
      acknowledged: null,
      power: 150,
    });
  });
  it('bounds recording memory and reports discarded samples', () => {
    const recorder = new ControlEvidence(),
      s = snapshot();
    for (let now = 0; now < 1300; now++) recorder.record(now, { receivedAt: now }, s);
    expect(recorder.samples).toHaveLength(1200);
    expect(recorder.report(s).droppedSamples).toBe(100);
  });
  it('reads acknowledged SIM slopes, including descents', () => {
    const s = snapshot();
    s.audit = [
      { at: 1, event: 'acknowledgement', bytes: [0x11, 0, 0, 0x9c, 0xff, 40, 16], result: 1 },
      { at: 2, event: 'acknowledgement', bytes: [0x11, 0, 0, 0x2c, 0x01, 40, 16], result: 4 },
    ];
    expect(lastGradeAcknowledgement(s)).toEqual({ grade: -1, at: 1 });
  });
});
