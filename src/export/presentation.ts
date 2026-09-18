import type { Session } from '../ride/engine';
import { clock } from '../workouts/model';

/** Text for the activity file and manual Strava upload; never claims completion of a stopped ride. */
export function activityPresentation(s: Session) {
  const title = `${s.source === 'demo' ? 'DEMO - ' : ''}BikeSIM - ${s.workout.name}`;
  const mode = s.route
    ? s.trainerControl === 'sim'
      ? 'SIM terrain with automatic trainer resistance'
      : 'SIM terrain with free pacing'
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

/** FIT field length is one byte, including the string terminator. Keep UTF-8 characters intact. */
export function fitText(text: string, maxBytes = 254) {
  const encoder = new TextEncoder();
  let result = '',
    bytes = 0;
  for (const char of text.replace(/\0/g, '')) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes) break;
    result += char;
    bytes += size;
  }
  return result;
}
