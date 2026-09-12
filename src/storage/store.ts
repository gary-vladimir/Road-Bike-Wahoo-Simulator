import { openDB } from 'idb';
import type { Session } from '../ride/engine';
import { validateWorkout, type Workout } from '../workouts/model';
import { validateRoute } from '../ride/terrain';
import type { PilotReport } from '../trainer/pilot-evidence';
import { stockWheel, validateWheel, type WheelSetup } from '../ride/bike';
export type Settings = {
  ftp: number | null;
  mass: number;
  bikeMass?: number;
  wheel?: WheelSetup;
  quality: 'high' | 'low';
};
export const defaults: Settings = {
  ftp: null,
  mass: 70,
  bikeMass: 9,
  wheel: stockWheel,
  quality: 'high',
};
const db = () =>
  openDB('bikesim', 1, {
    upgrade(db) {
      db.createObjectStore('settings');
      db.createObjectStore('workouts', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
    },
  });
export async function loadSettings(): Promise<Settings> {
  return structuredClone({ ...defaults, ...(await (await db()).get('settings', 'rider')) });
}
export async function saveSettings(settings: Settings) {
  await (await db()).put('settings', settings, 'rider');
}
/** Separate from rider settings/backups; restored for export only, never control resumption. */
export async function savePilotReport(report: PilotReport) {
  await (await db()).put('settings', report, 'last-pilot-report');
}
export async function loadPilotReport(): Promise<PilotReport | undefined> {
  return (await db()).get('settings', 'last-pilot-report');
}
export async function loadWorkouts(): Promise<Workout[]> {
  return (await db()).getAll('workouts');
}
export async function saveWorkout(workout: Workout) {
  validateWorkout(workout);
  await (await db()).put('workouts', workout);
}
export async function saveSession(session: Session) {
  await (await db()).put('sessions', session);
}
export async function loadSessions(): Promise<Session[]> {
  const sessions: Session[] = await (await db()).getAll('sessions');
  return sessions
    .map((s) => (s.status === 'in-progress' ? { ...s, status: 'interrupted' as const } : s))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export async function removeSession(id: string) {
  await (await db()).delete('sessions', id);
}
export async function backup() {
  const database = await db();
  return {
    version: 1,
    settings: await loadSettings(),
    workouts: await database.getAll('workouts'),
    sessions: await database.getAll('sessions'),
  };
}
export async function restoreBackup(raw: unknown) {
  const b = raw as Awaited<ReturnType<typeof backup>>;
  if (
    !b ||
    b.version !== 1 ||
    !Array.isArray(b.workouts) ||
    !Array.isArray(b.sessions) ||
    b.workouts.length > 500 ||
    b.sessions.length > 10000
  )
    throw new Error('This is not a supported BikeSIM backup.');
  b.workouts.forEach(validateWorkout);
  for (const s of b.sessions) {
    validateWorkout(s.workout);
    if (s.route) validateRoute(s.route);
    if (s.wheel) validateWheel(s.wheel);
    if (
      s.trainerControl !== undefined &&
      (s.trainerControl !== 'sim' || s.source !== 'bluetooth' || s.mode !== 'sim' || !s.route)
    )
      throw new Error('Invalid trainer control mode in backup.');
    if (
      (s.mode !== undefined && !['sim', 'erg'].includes(s.mode)) ||
      (s.route && s.mode !== 'sim') ||
      (s.mode === 'sim' && !s.route) ||
      (s.bikeMass !== undefined &&
        (!Number.isFinite(s.bikeMass) || s.bikeMass < 4 || s.bikeMass > 30))
    )
      throw new Error('Invalid session mode or bike mass');
    if (
      typeof s.id !== 'string' ||
      !s.id ||
      !Number.isFinite(Date.parse(s.startedAt)) ||
      !Array.isArray(s.samples) ||
      s.samples.length > 30000 ||
      !Number.isFinite(s.elapsed) ||
      s.elapsed < 0 ||
      s.elapsed > 21600 ||
      !Number.isFinite(s.distance) ||
      s.distance < 0 ||
      !['demo', 'bluetooth'].includes(s.source) ||
      !['in-progress', 'completed', 'stopped', 'interrupted'].includes(s.status) ||
      !Array.isArray(s.events) ||
      (s.ftp === null ? !s.route : !Number.isFinite(s.ftp)) ||
      !Number.isFinite(s.mass)
    )
      throw new Error('Invalid session in backup.');
    for (const p of s.samples)
      if (
        !p ||
        ![p.elapsed, p.power, p.target, p.speed, p.distance, p.grade].every(Number.isFinite) ||
        (p.cadence !== undefined && !Number.isFinite(p.cadence)) ||
        (p.timestamp !== undefined && !Number.isFinite(p.timestamp))
      )
        throw new Error('Invalid sample in backup.');
    if (s.recordedAt !== undefined && !Number.isFinite(s.recordedAt))
      throw new Error('Invalid recording time in backup.');
    if (
      s.timerEvents !== undefined &&
      (!Array.isArray(s.timerEvents) ||
        s.timerEvents.length > 30000 ||
        s.timerEvents.some(
          (e: NonNullable<Session['timerEvents']>[number]) =>
            !e ||
            !Number.isFinite(e.timestamp) ||
            !Number.isFinite(e.elapsed) ||
            !['start', 'stop'].includes(e.type),
        ))
    )
      throw new Error('Invalid timer events in backup.');
    for (const event of s.events)
      if (!event || !Number.isFinite(event.elapsed) || typeof event.message !== 'string')
        throw new Error('Invalid session event in backup.');
  }
  if (
    !b.settings ||
    (b.settings.ftp !== null &&
      (!Number.isFinite(b.settings.ftp) || b.settings.ftp < 50 || b.settings.ftp > 600)) ||
    !Number.isFinite(b.settings.mass) ||
    b.settings.mass < 35 ||
    b.settings.mass > 200 ||
    !['high', 'low'].includes(b.settings.quality) ||
    (b.settings.bikeMass !== undefined &&
      (!Number.isFinite(b.settings.bikeMass) ||
        b.settings.bikeMass < 4 ||
        b.settings.bikeMass > 30))
  )
    throw new Error('Invalid settings in backup.');
  if (b.settings.wheel) validateWheel(b.settings.wheel);
  const tx = (await db()).transaction(['workouts', 'sessions', 'settings'], 'readwrite');
  for (const w of b.workouts) await tx.objectStore('workouts').put(w);
  for (const s of b.sessions)
    await tx
      .objectStore('sessions')
      .put({ ...s, status: s.status === 'in-progress' ? 'interrupted' : s.status });
  await tx.objectStore('settings').put(b.settings, 'rider');
  await tx.done;
}
export function download(name: string, content: BlobPart, type = 'application/json') {
  const a = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function sessionCsv(s: Session) {
  return [
    'elapsed_s,power_w,cadence_rpm,target_w,virtual_speed_kmh,virtual_distance_km,visual_grade_pct',
    ...s.samples.map((p) =>
      [
        p.elapsed.toFixed(2),
        p.power,
        p.cadence ?? '',
        p.target,
        p.speed.toFixed(2),
        p.distance.toFixed(4),
        p.grade.toFixed(2),
      ].join(','),
    ),
  ].join('\n');
}
