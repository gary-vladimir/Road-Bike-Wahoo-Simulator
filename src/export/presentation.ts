import type { Session } from '../ride/engine';
import { clock } from '../workouts/model';

/** Text for the activity file and manual Strava upload; never claims completion of a stopped ride. */
export function activityPresentation(s: Session) {
  const title = `${s.source === 'demo' ? 'DEMO - ' : ''}BikeSIM - ${s.workout.name}`;
  const mode = s.route
    ? `${s.route.path ? `Virtual ride on the real ${s.route.name} road (OpenStreetMap, SRTM elevation), ` : ''}${
        s.trainerControl === 'sim'
          ? 'SIM terrain with automatic trainer resistance'
          : 'SIM terrain with free pacing'
      }`
    : `${s.workout.category} workout${s.trainerControl === 'erg' ? ' with automatic ERG power targets' : ' with target guidance'}`;
  const status =
    s.status === 'completed'
      ? 'Completed'
      : s.status === 'interrupted'
        ? 'Recovered partial ride'
        : 'Partial ride';
  const description = [
    `${status}: ${s.workout.name}.`,
    `Indoor cycling in BikeSIM. ${s.distance.toFixed(2)} km virtual distance in ${clock(s.elapsed)} active time.`,
    `${mode}. ${s.source === 'demo' ? 'Simulated demo data; not a real training activity.' : 'Recorded trainer power; virtual speed and distance.'}`,
    s.workout.description,
  ]
    .filter(Boolean)
    .join('\n\n');
  return { title, description };
}

/**
 * FIT field length is one byte, including the string terminator. Keep UTF-8 characters intact,
 * and end a shortened text at a word with an ellipsis rather than mid-word.
 */
export function fitText(text: string, maxBytes = 254) {
  const encoder = new TextEncoder();
  const clean = text.replace(/\0/g, '');
  if (encoder.encode(clean).length <= maxBytes) return clean;
  const budget = maxBytes - encoder.encode('…').length;
  let result = '',
    bytes = 0;
  for (const char of clean) {
    const size = encoder.encode(char).length;
    if (bytes + size > budget) break;
    result += char;
    bytes += size;
  }
  // Back up to the last word boundary unless that would drop a large part of the text.
  const boundary = result.search(/\s\S*$/);
  if (boundary > result.length * 0.6) result = result.slice(0, boundary);
  return `${result.replace(/[\s.,;:–-]+$/u, '')}…`;
}
