import {
  Encoder,
  Profile,
  type Mesg,
  type FileIdMesg,
  type SportMesg,
  type ActivityMesg,
  type RecordMesg,
  type SessionMesg,
  type EventMesg,
  type LapMesg,
  type WorkoutMesg,
} from '@garmin/fitsdk';
import type { Session } from '../ride/engine';
import { activityTimeline, fitExportIssue } from './activity';
import { activityPresentation, fitText } from './presentation';
import { routeCourse } from '../ride/course';
import { routePosition, type Route } from '../ride/terrain';
import { analyzeSession } from '../ride/analysis';

const semicircles = (degrees: number) => Math.round(degrees * (2 ** 31 / 180));
/**
 * Real roads know where they are: positions and altitude along the actual road, from the
 * route's own geometry (never a recorded GPS track). Practice roads have none.
 */
function realRoadGeo(route: Route) {
  const { path, origin } = route;
  if (!path?.length || !origin) return null;
  const step = route.pathStep ?? 10,
    course = routeCourse(route),
    k = Math.cos((origin.lat * Math.PI) / 180);
  return (meters: number) => {
    const f = Math.min(path.length - 1, Math.max(0, meters / step));
    const i = Math.min(path.length - 2, Math.floor(f)),
      t = f - i;
    const x = path[i][0] + (path[i + 1][0] - path[i][0]) * t,
      z = path[i][1] + (path[i + 1][1] - path[i][1]) * t;
    return {
      positionLat: semicircles(origin.lat - z / 110574),
      positionLong: semicircles(origin.lon + x / (111320 * k)),
      enhancedAltitude: course.elevation(meters),
    };
  };
}

// FIT timestamps have whole-second precision. Use UTC explicitly; never export local times as UTC.
const date = (milliseconds: number) => new Date(Math.floor(milliseconds / 1000) * 1000);

/**
 * FIT Activity (type 4), generated locally. No invented sensor readings. Real roads add their
 * positions and altitude and are marked as a virtual ride; everything else is indoor cycling.
 */
export function sessionFit(s: Session): Uint8Array {
  const issue = fitExportIssue(s);
  if (issue) throw new Error(issue);
  const timeline = activityTimeline(s),
    encoder = new Encoder();
  const write = <T extends Mesg>(num: number, message: T) => encoder.onMesg(num, message);
  const name = `${s.source === 'demo' ? 'DEMO - ' : ''}BikeSIM`;
  write<FileIdMesg>(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    productName: name,
    timeCreated: date(timeline.start),
  });
  const geo = s.route ? realRoadGeo(s.route) : null;
  // Indoor cycling, as the rider asked; a ride along a real road is a virtual ride with a map.
  const subSport = geo ? 'virtualActivity' : 'indoorCycling';
  const presentation = activityPresentation(s);
  write<SportMesg>(Profile.MesgNum.SPORT, { sport: 'cycling', subSport, name });
  write<WorkoutMesg>(Profile.MesgNum.WORKOUT, {
    sport: 'cycling',
    subSport,
    numValidSteps: 0,
    wktName: fitText(presentation.title),
    wktDescription: fitText(presentation.description),
  });

  // Last observation wins within the same FIT second. Do not manufacture zero cadence
  // when the sensor did not provide cadence. Preserve genuine zero-watt coast records.
  const records = new Map<number, { at: number; data: RecordMesg }>();
  records.set(date(timeline.start).getTime(), {
    at: timeline.start,
    data: { timestamp: date(timeline.start), distance: 0 },
  });
  for (const sample of s.samples) {
    const at = timeline.legacy ? timeline.start + sample.elapsed * 1000 : sample.timestamp!;
    const timestamp = date(at);
    const record: RecordMesg = {
      timestamp,
      distance: sample.distance * 1000,
      speed: sample.speed / 3.6,
      power: Math.round(sample.power),
    };
    if (sample.cadence !== undefined) record.cadence = Math.round(sample.cadence);
    // Virtual road slope, not trainer readback or a decorative workout hill.
    if (s.route) record.grade = sample.grade;
    if (geo) Object.assign(record, geo(sample.distance * 1000));
    records.set(timestamp.getTime(), { at, data: record });
  }
  const end = date(timeline.end);
  records.set(end.getTime(), {
    at: timeline.end,
    data: { ...records.get(end.getTime())?.data, timestamp: end, distance: s.distance * 1000 },
  });
  const messages: { at: number; priority: number; num: number; data: RecordMesg | EventMesg }[] = [
    ...records.values(),
  ].map(({ at, data }) => ({ at, priority: 1, num: Profile.MesgNum.RECORD, data }));
  timeline.events.forEach((e) =>
    messages.push({
      at: e.timestamp,
      priority: e.type === 'start' ? 0 : 2,
      num: Profile.MesgNum.EVENT,
      data: {
        timestamp: date(e.timestamp),
        event: 'timer',
        eventType: e.type === 'start' ? 'start' : 'stopAll',
        eventGroup: 0,
      },
    }),
  );
  // Keep the real chronological order even for events sharing the same FIT second.
  messages.sort((a, b) => a.at - b.at || a.priority - b.priority);
  messages.forEach((m) => encoder.onMesg(m.num, m.data));
  const summary = analyzeSession(s);
  const totals: LapMesg & SessionMesg = {
    timestamp: end,
    startTime: date(timeline.start),
    sport: 'cycling',
    subSport,
    totalElapsedTime: (timeline.end - timeline.start) / 1000,
    totalTimerTime: s.elapsed,
    totalDistance: s.distance * 1000,
    avgSpeed: (s.distance * 1000) / s.elapsed,
    maxSpeed: Math.max(...s.samples.map((p) => p.speed)) / 3.6,
    avgPower: Math.round(summary.averagePower),
    maxPower: Math.round(summary.maxPower),
    normalizedPower: Math.round(summary.normalizedPower),
    totalWork: Math.round(summary.work * 1000),
    ...(summary.averageCadence !== undefined
      ? { avgCadence: Math.round(summary.averageCadence) }
      : {}),
    ...(summary.intensity !== undefined
      ? {
          intensityFactor: Math.round(summary.intensity * 1000) / 1000,
          trainingStressScore: Math.round((summary.stress ?? 0) * 10) / 10,
          thresholdPower: s.ftp ?? undefined,
        }
      : {}),
    ...(geo && s.route
      ? { totalAscent: Math.round(routePosition(s.route, s.distance * 1000).ascent) }
      : {}),
  };
  write<LapMesg>(Profile.MesgNum.LAP, {
    ...totals,
    messageIndex: 0,
    event: 'lap',
    eventType: 'stop',
    lapTrigger: 'sessionEnd',
  });
  write<SessionMesg>(Profile.MesgNum.SESSION, {
    ...totals,
    messageIndex: 0,
    event: 'session',
    eventType: 'stop',
    firstLapIndex: 0,
    numLaps: 1,
    sportProfileName: fitText(presentation.title),
  });
  write<ActivityMesg>(Profile.MesgNum.ACTIVITY, {
    timestamp: end,
    totalTimerTime: s.elapsed,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  });
  return encoder.close();
}
