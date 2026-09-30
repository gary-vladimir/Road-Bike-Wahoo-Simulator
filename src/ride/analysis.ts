import type { Session } from './engine';
import { routePosition } from './terrain';
import { zones } from '../workouts/model';

export type RideAnalysis = {
  seconds: number;
  km: number;
  averagePower: number;
  maxPower: number;
  /** Normalized Power: 4th-power mean of the 30-second rolling average. */
  normalizedPower: number;
  /** kJ of mechanical work. */
  work: number;
  averageSpeed: number;
  maxSpeed: number;
  averageCadence?: number;
  climbed?: number;
  intensity?: number;
  stress?: number;
  zoneSeconds?: number[];
};

/** Summaries use recorded ~1 Hz samples; each sample stands for the time since the previous. */
export function analyzeSession(s: Session): RideAnalysis {
  const samples = s.samples;
  let previous = 0,
    seconds = 0,
    energy = 0,
    cadenceSum = 0,
    cadenceSeconds = 0,
    maxPower = 0,
    maxSpeed = 0;
  const perSecond: number[] = [];
  const zoneSeconds = zones.map(() => 0);
  for (const p of samples) {
    const dt = Math.max(0, Math.min(2.5, p.elapsed - previous));
    previous = p.elapsed;
    if (!dt) continue;
    seconds += dt;
    energy += p.power * dt;
    maxPower = Math.max(maxPower, p.power);
    maxSpeed = Math.max(maxSpeed, p.speed);
    // Coasting is part of the ride, but a 0 rpm pause should not drag cadence down.
    if (p.cadence !== undefined && p.cadence > 0) {
      cadenceSum += p.cadence * dt;
      cadenceSeconds += dt;
    }
    for (let i = 0; i < Math.round(dt); i++) perSecond.push(p.power);
    if (s.ftp) {
      const z = zones.findIndex((zone) => p.power / s.ftp! < zone.upTo);
      zoneSeconds[z === -1 ? zones.length - 1 : z] += dt;
    }
  }
  const averagePower = seconds ? energy / seconds : 0;
  let normalizedPower = averagePower;
  if (perSecond.length >= 30) {
    let window = 0,
      fourth = 0,
      count = 0;
    for (let i = 0; i < perSecond.length; i++) {
      window += perSecond[i];
      if (i >= 30) window -= perSecond[i - 30];
      if (i >= 29) {
        fourth += (window / 30) ** 4;
        count++;
      }
    }
    normalizedPower = (fourth / count) ** 0.25;
  }
  const intensity = s.ftp ? normalizedPower / s.ftp : undefined;
  return {
    seconds: s.elapsed,
    km: s.distance,
    averagePower,
    maxPower,
    normalizedPower,
    work: energy / 1000,
    averageSpeed: s.elapsed ? s.distance / (s.elapsed / 3600) : 0,
    maxSpeed,
    averageCadence: cadenceSeconds ? cadenceSum / cadenceSeconds : undefined,
    climbed: s.route ? routePosition(s.route, s.distance * 1000).ascent : undefined,
    intensity,
    stress: intensity === undefined ? undefined : (s.elapsed / 3600) * intensity ** 2 * 100,
    zoneSeconds: s.ftp ? zoneSeconds : undefined,
  };
}
