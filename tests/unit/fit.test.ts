import { describe, expect, it, vi, afterEach } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { sessionFit } from '../../src/export/fit';
import { activityFileName, fitExportIssue } from '../../src/export/activity';
import { exportSession } from '../fixtures/export-session';
import { RideEngine } from '../../src/ride/engine';
import { presets } from '../../src/workouts/model';

function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return {
    ...messages,
    fileIdMesgs: messages.fileIdMesgs ?? [],
    sessionMesgs: messages.sessionMesgs ?? [],
    lapMesgs: messages.lapMesgs ?? [],
    activityMesgs: messages.activityMesgs ?? [],
    eventMesgs: messages.eventMesgs ?? [],
    recordMesgs: messages.recordMesgs ?? [],
  };
}
afterEach(() => vi.useRealTimers());
describe('Strava FIT activity export', () => {
  it('encodes an activity with UTC timestamps, pauses, correct units and zero-watt coasting', () => {
    const s = exportSession(),
      bytes = sessionFit(s),
      m = decode(bytes);
    expect(m.fileIdMesgs).toHaveLength(1);
    expect(m.fileIdMesgs[0]).toMatchObject({
      type: 'activity',
      manufacturer: 'development',
      productName: 'BikeSIM',
    });
    expect(m.sessionMesgs).toHaveLength(1);
    expect(m.lapMesgs).toHaveLength(1);
    expect(m.activityMesgs).toHaveLength(1);
    expect(m.sessionMesgs[0]).toMatchObject({
      sport: 'cycling',
      subSport: 'virtualActivity',
      totalTimerTime: 10,
      totalElapsedTime: 20,
      totalDistance: 30,
    });
    expect(m.sessionMesgs[0].startTime).toEqual(new Date('2026-09-11T14:00:00Z'));
    expect(m.sessionMesgs[0].timestamp).toEqual(new Date('2026-09-11T14:00:20Z'));
    expect(m.eventMesgs.map((e) => e.eventType)).toEqual(['start', 'stopAll', 'start', 'stopAll']);
    expect(m.recordMesgs.map((r) => r.power)).toEqual([undefined, 150, 0, 0, 100, 120]);
    expect(m.recordMesgs[3]).toMatchObject({ distance: 15, speed: 4, cadence: 0 });
    expect(m.recordMesgs[4]).not.toHaveProperty('cadence');
    expect(
      m.recordMesgs.every(
        (r) => !('positionLat' in r) && !('positionLong' in r) && !('heartRate' in r),
      ),
    ).toBe(true);
    expect(m.recordMesgs.every((r) => r.timestamp instanceof Date)).toBe(true);
    expect(m.lapMesgs[0].totalDistance).toBe(m.sessionMesgs[0].totalDistance);
    expect(m.activityMesgs[0].totalTimerTime).toBe(10);
    expect(sessionFit(s)).toEqual(bytes); // Redownloads retain the original activity identity/time.
  });
  it('exports old workout history using active time and labels demo files', () => {
    const s = exportSession();
    delete s.timerEvents;
    delete s.recordedAt;
    delete s.route;
    s.samples.forEach((p) => delete p.timestamp);
    s.mode = 'erg';
    s.source = 'demo';
    const m = decode(sessionFit(s));
    expect(m.sessionMesgs[0]).toMatchObject({
      subSport: 'indoorCycling',
      totalElapsedTime: 10,
      totalTimerTime: 10,
    });
    expect(m.sessionMesgs[0].startTime).toEqual(new Date(s.startedAt));
    expect(m.fileIdMesgs[0].productName).toContain('DEMO');
    expect(activityFileName(s)).toMatch(/^bikesim-DEMO-2026-09-11-Valley-coast-climb-.*\.fit$/);
  });
  it('closes recovered open timers at the saved checkpoint and preserves final distance', () => {
    const s = exportSession();
    s.status = 'interrupted';
    s.timerEvents!.pop();
    s.samples.pop();
    const m = decode(sessionFit(s));
    expect(m.eventMesgs.at(-1)?.eventType).toBe('stopAll');
    expect(m.recordMesgs.at(-1)).toMatchObject({ distance: 30 });
    expect(m.recordMesgs.at(-1)).not.toHaveProperty('power');
    expect(m.sessionMesgs[0].totalTimerTime).toBe(10);
  });
  it('rejects empty, unfinished, corrupt and non-monotonic activities', () => {
    for (const mutate of [
      (s: ReturnType<typeof exportSession>) => {
        s.samples = [];
      },
      (s: ReturnType<typeof exportSession>) => {
        s.status = 'in-progress';
      },
      (s: ReturnType<typeof exportSession>) => {
        s.distance = NaN;
      },
      (s: ReturnType<typeof exportSession>) => {
        s.samples[1].distance = -1;
      },
      (s: ReturnType<typeof exportSession>) => {
        s.samples[1].timestamp! -= 100000;
      },
      (s: ReturnType<typeof exportSession>) => {
        s.samples[0].cadence = 255;
      },
      (s: ReturnType<typeof exportSession>) => {
        s.timerEvents![1].elapsed = 50;
      },
    ]) {
      const s = exportSession();
      mutate(s);
      expect(fitExportIssue(s)).toBeTruthy();
      expect(() => sessionFit(s)).toThrow();
    }
  });
  it('records real timing, pause boundaries and a partial final sample in new rides', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-09-11T14:00:00Z');
    const e = new RideEngine(presets[0], 'bluetooth', 200, 70);
    const tick = (t: number) =>
      e.tick(t, { power: 0, cadence: 0, powerAt: t, cadenceAt: t, receivedAt: t });
    for (let t = 0; t <= 16000; t += 1000) tick(t);
    e.pause();
    e.resume();
    for (let t = 20000; t <= 26000; t += 1000) tick(t);
    tick(26300);
    e.finish();
    expect(e.session.elapsed).toBeCloseTo(9.3);
    expect(e.session.samples.at(-1)?.elapsed).toBeCloseTo(9.3);
    expect(e.session.timerEvents!.map((t) => t.type)).toEqual(['start', 'stop', 'start', 'stop']);
    const m = decode(sessionFit(e.session));
    expect(m.sessionMesgs[0].totalTimerTime).toBeCloseTo(9.3);
    expect(m.sessionMesgs[0].totalElapsedTime).toBeCloseTo(16.3);
    expect(m.sessionMesgs[0].startTime).toEqual(new Date('2026-09-11T14:00:10Z'));
    expect(m.recordMesgs.filter((r) => r.power !== undefined).every((r) => r.power === 0)).toBe(
      true,
    );
  });
  it('stops timing at the last valid tick when the browser stalls', () => {
    const e = new RideEngine(presets[0], 'demo', 200, 70);
    for (let t = 0; t <= 15000; t += 1000) e.tick(t);
    e.tick(100000);
    e.finish();
    const m = decode(sessionFit(e.session));
    expect(m.sessionMesgs[0]).toMatchObject({ totalTimerTime: 5, totalElapsedTime: 5 });
  });
});
