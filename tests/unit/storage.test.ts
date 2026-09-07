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
} from '../../src/storage/store';
import { RideEngine } from '../../src/ride/engine';
import { presets } from '../../src/workouts/model';
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
describe('local persistence and backup boundaries', () => {
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
