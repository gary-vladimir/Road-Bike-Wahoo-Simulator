import { openDB } from 'idb';
import type { Session } from '../ride/engine';
import { validateWorkout, type Workout } from '../workouts/model';
import { validateRoute } from '../ride/terrain';
import type { ControlReport } from '../trainer/evidence';
import { stockWheel, validateWheel, type WheelSetup } from '../ride/bike';
import { validateFtpAssessment, type FtpAssessment } from '../ride/ftp-test';
import { ridingPositions, type RidingPosition } from '../ride/physics';
export type Settings = {
  ftp: number | null;
  mass: number;
  bikeMass?: number;
  wheel?: WheelSetup;
  /** Aerodynamic riding position for virtual speed and SIM drag. */
  position?: RidingPosition;
  /** Rider opt-in: BikeSIM may set trainer load during rides it starts. */
  trainerControl?: boolean;
  /** Percent of the road slope sent to the trainer in SIM (Zwift-style trainer difficulty). */
  difficulty?: number;
  quality: 'high' | 'low';
};
export const defaults: Settings = {
  ftp: null,
  mass: 70,
  bikeMass: 9,
  wheel: stockWheel,
  position: 'hoods',
  trainerControl: false,
  difficulty: 100,
  quality: 'high',
};
// One shared connection per IndexedDB factory (tests swap the factory between cases).
let connection: { factory: IDBFactory; db: ReturnType<typeof open> } | undefined;
const open = () =>
  openDB('bikesim', 1, {
    upgrade(db) {
      db.createObjectStore('settings');
      db.createObjectStore('workouts', { keyPath: 'id' });
      db.createObjectStore('sessions', { keyPath: 'id' });
    },
    blocking() {
      // Another tab needs a newer schema: release this connection.
      void connection?.db.then((d) => d.close());
      connection = undefined;
    },
  });
const db = () => {
  if (connection?.factory !== globalThis.indexedDB) {
    const pending = open();
    const entry = { factory: globalThis.indexedDB, db: pending };
    connection = entry;
    pending.catch(() => {
      if (connection === entry) connection = undefined;
    });
  }
  return connection!.db;
};
export async function loadSettings(): Promise<Settings> {
  return structuredClone({ ...defaults, ...(await (await db()).get('settings', 'rider')) });
}
export async function saveSettings(settings: Settings) {
  await (await db()).put('settings', settings, 'rider');
}
export async function loadFtpAssessments(): Promise<FtpAssessment[]> {
  const reports: FtpAssessment[] = (await (await db()).get('settings', 'ftp-assessments')) ?? [];
  return reports.map((r) =>
    r.status === 'in-progress'
      ? {
          ...r,
          status: 'interrupted',
          reason: 'The assessment was interrupted. FTP was not changed.',
        }
      : r,
  );
}
/** Result and rider FTP are committed together; interrupted attempts never apply an estimate. */
export async function saveFtpAssessment(report: FtpAssessment, apply = false) {
  validateFtpAssessment(report);
  if (apply && report.status !== 'estimated')
    throw new Error('Only a valid assessment can set FTP.');
  const tx = (await db()).transaction('settings', 'readwrite');
  const reports: FtpAssessment[] = (await tx.store.get('ftp-assessments')) ?? [];
  await tx.store.put(
    [structuredClone(report), ...reports.filter((r) => r.id !== report.id)].slice(0, 50),
    'ftp-assessments',
  );
  if (apply) {
    const rider = { ...defaults, ...(await tx.store.get('rider')), ftp: report.ftp };
    await tx.store.put(rider, 'rider');
  }
  await tx.done;
}
/** Separate from rider settings/backups; restored for export only, never control resumption. */
// Stored under its original key so the last manual check survives this rename.
export async function saveControlReport(report: ControlReport) {
  await (await db()).put('settings', report, 'last-pilot-report');
}
export async function loadControlReport(): Promise<ControlReport | undefined> {
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
    ftpAssessments: await loadFtpAssessments(),
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
  if (b.ftpAssessments !== undefined) {
    if (!Array.isArray(b.ftpAssessments) || b.ftpAssessments.length > 50)
      throw new Error('Invalid FTP assessment history.');
    b.ftpAssessments.forEach(validateFtpAssessment);
  }
  for (const s of b.sessions) {
    validateWorkout(s.workout);
    if (s.route) validateRoute(s.route);
    if (s.wheel) validateWheel(s.wheel);
    if (
      s.trainerControl !== undefined &&
      (s.source !== 'bluetooth' ||
        (s.trainerControl === 'sim'
          ? s.mode !== 'sim' || !s.route
          : s.trainerControl === 'erg'
            ? s.mode !== 'erg' || !!s.route || s.ftp === null
            : true))
    )
      throw new Error('Invalid trainer control mode in backup.');
    if (
      (s.mode !== undefined && !['sim', 'erg'].includes(s.mode)) ||
      (s.route && s.mode !== 'sim') ||
      (s.mode === 'sim' && !s.route) ||
      (s.bikeMass !== undefined &&
        (!Number.isFinite(s.bikeMass) || s.bikeMass < 4 || s.bikeMass > 30)) ||
      (s.position !== undefined && !Object.hasOwn(ridingPositions, s.position)) ||
      (s.airDensity !== undefined &&
        (!Number.isFinite(s.airDensity) || s.airDensity < 0.6 || s.airDensity > 1.4))
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
    (b.settings.position !== undefined && !Object.hasOwn(ridingPositions, b.settings.position)) ||
    (b.settings.trainerControl !== undefined && typeof b.settings.trainerControl !== 'boolean') ||
    (b.settings.difficulty !== undefined &&
      (!Number.isFinite(b.settings.difficulty) ||
        b.settings.difficulty < 0 ||
        b.settings.difficulty > 100)) ||
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
  // A backup never switches trainer control on by itself: keep this browser's choice.
  const current: Partial<Settings> = (await tx.objectStore('settings').get('rider')) ?? {};
  await tx
    .objectStore('settings')
    .put({ ...b.settings, trainerControl: current.trainerControl ?? false }, 'rider');
  if (b.ftpAssessments) {
    const existing: FtpAssessment[] =
      (await tx.objectStore('settings').get('ftp-assessments')) ?? [];
    const imported = b.ftpAssessments.map((r) =>
      r.status === 'in-progress'
        ? {
            ...r,
            status: 'interrupted' as const,
            reason: 'Imported incomplete assessment. FTP unchanged.',
          }
        : r,
    );
    await tx
      .objectStore('settings')
      .put(
        [...imported, ...existing.filter((r) => !imported.some((i) => i.id === r.id))].slice(0, 50),
        'ftp-assessments',
      );
  }
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
