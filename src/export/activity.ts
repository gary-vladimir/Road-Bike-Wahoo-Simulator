import type { Session } from '../ride/engine';

const fitEpoch = Date.UTC(1989, 11, 31);
const validTime = (t: number) =>
  Number.isFinite(t) && t >= fitEpoch && t < fitEpoch + 0xfffffffe * 1000;

/** Older sessions lack wall-clock pause durations; retain their recorded active timeline. */
export function activityTimeline(session: Session) {
  if (!session.timerEvents?.length) {
    const start = Date.parse(session.startedAt),
      end = start + session.elapsed * 1000;
    return {
      start,
      end,
      legacy: true,
      events: [
        { type: 'start' as const, timestamp: start, elapsed: 0 },
        { type: 'stop' as const, timestamp: end, elapsed: session.elapsed },
      ],
    };
  }
  const events = session.timerEvents.map((e) => ({ ...e }));
  if (events.at(-1)!.type === 'start')
    events.push({ type: 'stop', timestamp: session.recordedAt!, elapsed: session.elapsed });
  return { start: events[0].timestamp, end: events.at(-1)!.timestamp, legacy: false, events };
}

export function fitExportIssue(s: Session): string | null {
  if (s.status === 'in-progress') return 'Finish the ride before exporting its activity file.';
  if (!s.samples.length || s.elapsed < 1)
    return 'Record at least one second of riding before exporting a FIT activity.';
  if (
    !Number.isFinite(s.elapsed) ||
    s.elapsed > 21600 ||
    s.samples.length > 30000 ||
    (s.timerEvents?.length ?? 0) > 30000 ||
    !Number.isFinite(s.distance) ||
    s.distance < 0 ||
    s.distance > 1000
  )
    return 'This ride has invalid duration or distance. Its original JSON is still available.';
  const timeline = activityTimeline(s);
  if (!validTime(timeline.start) || !validTime(timeline.end) || timeline.end <= timeline.start)
    return 'This ride has invalid recording dates.';
  let previousElapsed = 0,
    previousDistance = 0,
    previousTime = timeline.start;
  for (const sample of s.samples) {
    const at = timeline.legacy ? timeline.start + sample.elapsed * 1000 : sample.timestamp!;
    if (
      ![sample.elapsed, sample.power, sample.speed, sample.distance].every(Number.isFinite) ||
      sample.elapsed < previousElapsed ||
      sample.elapsed > s.elapsed + 0.001 ||
      sample.power < 0 ||
      sample.power > 65534 ||
      sample.speed < 0 ||
      sample.speed > 150 ||
      (s.route && (!Number.isFinite(sample.grade) || Math.abs(sample.grade) > 30)) ||
      sample.distance < previousDistance ||
      sample.distance > s.distance + 0.00001 ||
      (sample.cadence !== undefined &&
        (!Number.isFinite(sample.cadence) || sample.cadence < 0 || sample.cadence > 254)) ||
      !validTime(at) ||
      at < previousTime ||
      at > timeline.end + 1
    )
      return 'This ride contains invalid or out-of-order readings. Its original JSON is still available.';
    previousElapsed = sample.elapsed;
    previousDistance = sample.distance;
    previousTime = at;
  }
  for (let i = 0; i < timeline.events.length; i++) {
    const event = timeline.events[i],
      before = timeline.events[i - 1];
    if (
      !validTime(event.timestamp) ||
      !Number.isFinite(event.elapsed) ||
      event.type !== (i % 2 === 0 ? 'start' : 'stop') ||
      (i === 0
        ? event.elapsed !== 0
        : event.timestamp < before.timestamp || event.elapsed < before.elapsed) ||
      event.elapsed > s.elapsed + 0.001 ||
      (i > 0 &&
        (event.type === 'start'
          ? Math.abs(event.elapsed - before.elapsed) > 0.001
          : Math.abs(
              (event.timestamp - before.timestamp) / 1000 - (event.elapsed - before.elapsed),
            ) > 0.02))
    )
      return 'This ride has inconsistent pause timing. Its original JSON is still available.';
  }
  if (Math.abs(timeline.events.at(-1)!.elapsed - s.elapsed) > 0.001)
    return 'This ride has incomplete timer data.';
  return null;
}

export function activityFileName(s: Session) {
  const name =
    s.workout.name
      // "Albán" → "Alban": drop the accents that NFKD splits off, not the letters around them.
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'ride';
  const id = s.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  return `bikesim-${s.source === 'demo' ? 'DEMO-' : ''}${s.startedAt.slice(0, 10)}-${name}-${id}.fit`;
}
