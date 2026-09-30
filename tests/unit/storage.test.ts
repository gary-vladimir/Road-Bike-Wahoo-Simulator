import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  backup,
  loadSessions,
  loadSettings,
  loadWorkouts,
  restoreBackup,
  saveSession,
  saveSettings,
  saveWorkout,
  saveControlReport,
  loadControlReport,
  loadFtpAssessments,
  saveFtpAssessment,
} from '../../src/storage/store';
import { RideEngine } from '../../src/ride/engine';
import { presets } from '../../src/workouts/model';
import { routes, routeWorkout } from '../../src/ride/terrain';
import { ControlEvidence } from '../../src/trainer/evidence';
import { estimateFtp, ftpTarget, type FtpAssessment } from '../../src/ride/ftp-test';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
describe('local persistence and backup boundaries', () => {
  it('atomically applies valid FTP estimates, preserves FTP on interruption and round-trips assessment evidence', async () => {
    await saveSettings({ ftp: 200, mass: 70, quality: 'low' });
    const readings = Array.from({ length: 720 }, (_, i) => ({
      start: i,
      end: i + 1,
      power: ftpTarget('gentle', i),
      cadence: 80,
      target: ftpTarget('gentle', i),
      acknowledged: ftpTarget('gentle', i),
    }));
    const report: FtpAssessment = {
      version: 1,
      id: 'ftp-result',
      startedAt: new Date().toISOString(),
      protocol: 'gentle',
      status: 'estimated',
      elapsed: 720,
      readings,
      stopConfirmed: true,
      ...estimateFtp(readings),
    };
    await saveFtpAssessment(report, true);
    expect(await loadSettings()).toMatchObject({ ftp: 83, mass: 70, quality: 'low' });
    const pending: FtpAssessment = {
      ...report,
      id: 'pending',
      status: 'in-progress',
      ftp: undefined,
      bestMinute: undefined,
    };
    await saveFtpAssessment(pending);
    expect((await loadFtpAssessments())[0].status).toBe('interrupted');
    await expect(saveFtpAssessment(pending, true)).rejects.toThrow('valid assessment');
    expect((await loadSettings()).ftp).toBe(83);
    const b = await backup();
    globalThis.indexedDB = new IDBFactory();
    await restoreBackup(b);
    expect((await loadFtpAssessments()).find((r) => r.id === report.id)).toEqual(report);
    b.ftpAssessments[1].ftp = 250;
    await expect(restoreBackup(b)).rejects.toThrow('estimate');
    expect((await loadSettings()).ftp).toBe(83);
  });
  it('round-trips automatic ERG metadata without arming control and rejects mode mismatches', async () => {
    const e = new RideEngine(presets[0], 'bluetooth', 200, 70, { trainerControl: 'erg' });
    await saveSession(e.session);
    const b = await backup();
    await restoreBackup(b);
    expect((await loadSessions())[0]).toMatchObject({
      trainerControl: 'erg',
      mode: 'erg',
      status: 'interrupted',
    });
    b.sessions[0].route = routes[0];
    await expect(restoreBackup(b)).rejects.toThrow('control mode');
  });
  it('saves diagnostic evidence separately without changing rider settings or restoring control', async () => {
    const report = new ControlEvidence().report({
      state: 'active',
      mode: 'erg',
      recovery: false,
      appliedWatts: 75,
      requestedWatts: 100,
      stopConfirmed: false,
      releaseConfirmed: false,
      message: '',
      audit: [],
      machineStatus: [],
    });
    await saveSettings({ ftp: 210, mass: 70, quality: 'low' });
    await saveControlReport(report);
    expect(await loadControlReport()).toEqual(report);
    expect((await loadSettings()).ftp).toBe(210);
    expect((await backup()).settings).not.toHaveProperty('audit');
  });
  it('round-trips SIM routes with unknown FTP and rejects corrupted terrain atomically', async () => {
    const e = new RideEngine(routeWorkout(routes[0]), 'demo', null, 75, {
      route: routes[0],
      bikeMass: 10,
    });
    await saveSession(e.session);
    expect((await loadSessions())[0].wheel?.circumferenceMm).toBe(2155);
    const b = await backup();
    globalThis.indexedDB = new IDBFactory();
    await restoreBackup(b);
    expect((await loadSessions())[0]).toMatchObject({
      mode: 'sim',
      ftp: null,
      bikeMass: 10,
      route: routes[0],
    });
    b.sessions[0].route!.points[0].grade = 100;
    await expect(restoreBackup(b)).rejects.toThrow('route profile');
    expect((await loadSessions())[0].route?.points[0].grade).toBe(0);
  });
  it('defaults to the confirmed setup, preserves stored weights and rejects invalid wheel imports atomically', async () => {
    expect(await loadSettings()).toMatchObject({
      mass: 70,
      wheel: { beadSeatMm: 622, tireWidthMm: 32, circumferenceMm: 2155 },
    });
    await saveSettings({ ftp: null, mass: 72, quality: 'low' });
    expect((await loadSettings()).mass).toBe(72);
    const b = await backup();
    b.settings.wheel!.circumferenceMm = 0;
    await expect(restoreBackup(b)).rejects.toThrow('wheel');
    expect((await loadSettings()).wheel!.circumferenceMm).toBe(2155);
  });
  it('round-trips custom workouts, profile and ride samples', async () => {
    const workout = { ...structuredClone(presets[0]), id: 'custom-example', custom: true };
    await saveWorkout(workout);
    await saveSettings({ ftp: 220, mass: 72, quality: 'low' });
    const e = new RideEngine(workout, 'demo', 220, 72);
    for (let t = 0; t < 20000; t += 100) e.tick(t);
    e.finish();
    await saveSession(e.session);
    const b = await backup();
    globalThis.indexedDB = new IDBFactory();
    await restoreBackup(b);
    expect(await loadSettings()).toMatchObject({ ftp: 220, mass: 72 });
    expect(await loadWorkouts()).toEqual([workout]);
    expect((await loadSessions())[0].samples).toEqual(e.session.samples);
  });
  it('recovers in-progress records as interrupted, without resuming', async () => {
    const e = new RideEngine(presets[0], 'demo', 200, 75);
    await saveSession(e.session);
    const recovered = await loadSessions();
    expect(recovered[0].status).toBe('interrupted');
    expect(recovered[0].elapsed).toBe(0);
  });
  it('rejects malformed imports before any records or settings change', async () => {
    await saveSettings({ ftp: 210, mass: 70, quality: 'high' });
    const b = await backup();
    const e = new RideEngine(presets[0], 'demo', 200, 75);
    b.sessions.push({ ...e.session, events: null as never });
    b.settings.ftp = 400;
    await expect(restoreBackup(b)).rejects.toThrow('Invalid session');
    expect((await loadSettings()).ftp).toBe(210);
    expect(await loadSessions()).toEqual([]);
  });
  it('merges valid backups without deleting unrelated rides', async () => {
    const first = new RideEngine(presets[0], 'demo', 200, 75),
      second = new RideEngine(presets[1], 'demo', 200, 75);
    await saveSession(first.session);
    const b = await backup();
    await saveSession(second.session);
    await restoreBackup(b);
    expect(await loadSessions()).toHaveLength(2);
  });
  it('persists riding position and rejects unknown positions in backups', async () => {
    expect((await loadSettings()).position).toBe('hoods');
    await saveSettings({ ...(await loadSettings()), position: 'aero' });
    // Reuses one connection for repeated reads.
    expect((await Promise.all([loadSettings(), loadSettings()])).map((x) => x.position)).toEqual([
      'aero',
      'aero',
    ]);
    const data = await backup();
    await expect(
      restoreBackup({ ...data, settings: { ...data.settings, position: 'superman' } }),
    ).rejects.toThrow('Invalid settings');
    expect((await loadSettings()).position).toBe('aero');
  });
});
