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
  savePilotReport,
  loadPilotReport,
} from '../../src/storage/store';
import { RideEngine } from '../../src/ride/engine';
import { presets } from '../../src/workouts/model';
import { routes } from '../../src/ride/terrain';
import { routeWorkout } from '../../src/ui/RoadSetup';
import { PilotEvidence } from '../../src/trainer/pilot-evidence';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
describe('local persistence and backup boundaries', () => {
  it('saves diagnostic evidence separately without changing rider settings or restoring control', async () => {
    const report = new PilotEvidence().report({
      state: 'running',
      applied: 75,
      requested: 100,
      message: '',
      audit: [],
      machineStatus: [],
    });
    await saveSettings({ ftp: 210, mass: 70, quality: 'low' });
    await savePilotReport(report);
    expect(await loadPilotReport()).toEqual(report);
    expect((await loadSettings()).ftp).toBe(210);
    expect((await backup()).settings).not.toHaveProperty('audit');
  });
  it('round-trips SIM routes with unknown FTP and rejects corrupted terrain atomically', async () => {
    const e = new RideEngine(routeWorkout(routes[0]), 'demo', null, 75, {
      route: routes[0],
      bikeMass: 10,
    });
    await saveSession(e.session);
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
});
