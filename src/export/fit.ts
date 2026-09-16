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
} from '@garmin/fitsdk';
import type { Session } from '../ride/engine';
import { activityTimeline, fitExportIssue } from './activity';

// FIT timestamps have whole-second precision. Use UTC explicitly; never export local times as UTC.
const date = (milliseconds: number) => new Date(Math.floor(milliseconds / 1000) * 1000);

/** FIT Activity (type 4), generated locally. No GPS positions or invented sensor readings. */
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
  const subSport = s.mode === 'sim' || s.route ? 'virtualActivity' : 'indoorCycling';
  write<SportMesg>(Profile.MesgNum.SPORT, { sport: 'cycling', subSport, name });

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
    sportProfileName: `${name} - ${s.workout.name}`.slice(0, 80),
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
