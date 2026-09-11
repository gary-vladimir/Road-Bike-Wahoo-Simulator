import type { Session } from '../../src/ride/engine';
import { presets } from '../../src/workouts/model';
import { routes } from '../../src/ride/terrain';

/** Synthetic live-power shape; never uploaded to a real athlete account. */
export function exportSession(): Session {
  const start = Date.parse('2026-09-11T08:00:00-06:00');
  return {
    id: 'fit-export-regression',
    workout: { ...structuredClone(presets[0]), name: 'Valley coast & climb' },
    startedAt: new Date(start - 10000).toISOString(),
    source: 'bluetooth',
    ftp: null,
    mass: 70,
    mode: 'sim',
    route: structuredClone(routes[2]),
    elapsed: 10,
    distance: 0.03,
    status: 'completed',
    events: [],
    recordedAt: start + 20000,
    timerEvents: [
      { timestamp: start, elapsed: 0, type: 'start' },
      { timestamp: start + 5000, elapsed: 5, type: 'stop' },
      { timestamp: start + 15000, elapsed: 5, type: 'start' },
      { timestamp: start + 20000, elapsed: 10, type: 'stop' },
    ],
    samples: [
      {
        elapsed: 1,
        timestamp: start + 1000,
        power: 150,
        cadence: 80,
        distance: 0.002,
        speed: 10,
        target: 0,
        grade: 0,
      },
      {
        elapsed: 4,
        timestamp: start + 4000,
        power: 0,
        cadence: 0,
        distance: 0.011,
        speed: 14,
        target: 0,
        grade: -3,
      },
      {
        elapsed: 5,
        timestamp: start + 5000,
        power: 0,
        cadence: 0,
        distance: 0.015,
        speed: 14.4,
        target: 0,
        grade: -3,
      },
      {
        elapsed: 6,
        timestamp: start + 16000,
        power: 100,
        distance: 0.018,
        speed: 10.8,
        target: 0,
        grade: 1,
      },
      {
        elapsed: 10,
        timestamp: start + 20000,
        power: 120,
        cadence: 76,
        distance: 0.03,
        speed: 10.8,
        target: 0,
        grade: 1,
      },
    ],
  };
}
