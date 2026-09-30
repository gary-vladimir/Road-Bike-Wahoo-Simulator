import type { Workout } from '../workouts/model';
/** Free rides reuse the workout timeline for their six-hour session limit; no watt targets. */
export function routeWorkout(route: Route): Workout {
  const block = {
    name: 'Your own pace',
    seconds: 10800,
    from: 0.5,
    to: 0.5,
    cadence: 80,
    grade: 0,
    cue: 'Choose your own effort and cadence.',
  };
  return {
    id: `route-${route.id}`,
    name: route.name,
    category: 'Endurance',
    description: route.description,
    blocks: [block, { ...block }],
  };
}
export type Route = {
  id: string;
  name: string;
  description: string;
  /** Grade profile by distance: the source of truth for physics and elevation. */
  points: { meters: number; grade: number }[];
  /** Real roads: centerline in local meters (x east, z south), one point every `pathStep` m. */
  path?: [number, number][];
  pathStep?: number;
  /** Absolute elevation at the start, in meters. */
  startElevation?: number;
  /** Terrain height models shipped with a real road: detailed near it, coarse to the horizon. */
  terrain?: { near: TerrainGrid; far: TerrainGrid };
  /** Data sources to credit, for real roads. */
  attribution?: string;
  /** Real roads: a short label ("Classic climb"), place and start coordinates. */
  kind?: string;
  region?: string;
  origin?: { lat: number; lon: number };
};
/** A regular height grid in the route's local meters (uint16 samples: height = offset + v × scale). */
export type TerrainGrid = {
  file: string;
  x0: number;
  z0: number;
  spacing: number;
  columns: number;
  rows: number;
  offset: number;
  scale: number;
};
export const routes: Route[] = [
  {
    id: 'valley',
    name: 'Valley warm-up',
    description: 'A gentle 3 km road with small rises. Find a comfortable gear and settle in.',
    points: [
      { meters: 0, grade: 0 },
      { meters: 400, grade: 0 },
      { meters: 1000, grade: 1 },
      { meters: 1800, grade: 0 },
      { meters: 2400, grade: -0.5 },
      { meters: 3000, grade: 0 },
    ],
  },
  {
    id: 'foothills',
    name: 'Rolling foothills',
    description:
      'Six kilometers of rolling terrain. Shift down for the climbs and recover on the descents.',
    points: [
      { meters: 0, grade: 0 },
      { meters: 400, grade: 0 },
      { meters: 1600, grade: 4 },
      { meters: 2300, grade: 0 },
      { meters: 3200, grade: -3.5 },
      { meters: 3900, grade: 0 },
      { meters: 4600, grade: 3 },
      { meters: 5300, grade: -2 },
      { meters: 6000, grade: 0 },
    ],
  },
  {
    id: 'descent',
    name: 'Descent to the valley',
    description:
      'A 2 km downhill start, a level valley, then a gentle rise. Coast to feel gravity and momentum.',
    points: [
      { meters: 0, grade: -3 },
      { meters: 500, grade: -3 },
      { meters: 800, grade: 0 },
      { meters: 1200, grade: 0 },
      { meters: 1500, grade: 3 },
      { meters: 1850, grade: 3 },
      { meters: 2000, grade: 0 },
    ],
  },
  {
    id: 'ascent',
    name: 'The steady ascent',
    description:
      'A 5 km climb that builds gradually. Choose your own cadence and use your climbing gears.',
    points: [
      { meters: 0, grade: 0 },
      { meters: 500, grade: 0 },
      { meters: 1500, grade: 3 },
      { meters: 3000, grade: 5 },
      { meters: 4200, grade: 3 },
      { meters: 5000, grade: 0 },
    ],
  },
];
export function validateRoute(route: Route) {
  if (
    !route ||
    typeof route.id !== 'string' ||
    !route.id ||
    typeof route.name !== 'string' ||
    !route.name ||
    typeof route.description !== 'string' ||
    !Array.isArray(route.points) ||
    route.points.length < 2 ||
    route.points.length > 20000
  )
    throw new Error('Invalid route');
  route.points.forEach((p, i) => {
    if (
      !p ||
      !Number.isFinite(p.meters) ||
      !Number.isFinite(p.grade) ||
      Math.abs(p.grade) > 20 ||
      (i === 0 ? p.meters !== 0 : p.meters <= route.points[i - 1].meters)
    )
      throw new Error('Invalid route profile');
  });
  if (routeLength(route) < 100 || routeLength(route) > 200000)
    throw new Error('Route distance out of range');
  if (
    (route.startElevation !== undefined &&
      (!Number.isFinite(route.startElevation) ||
        route.startElevation < -500 ||
        route.startElevation > 6000)) ||
    (route.path !== undefined &&
      (!Array.isArray(route.path) ||
        route.path.length < 2 ||
        route.path.length > 100000 ||
        !Number.isFinite(route.pathStep) ||
        route.pathStep! < 1 ||
        route.pathStep! > 50 ||
        route.path.some(
          (p) => !Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isFinite(n)),
        ))) ||
    (route.attribution !== undefined && typeof route.attribution !== 'string') ||
    (route.terrain !== undefined &&
      ![route.terrain?.near, route.terrain?.far].every(
        (g) =>
          g &&
          // Only BikeSIM's own height files, never another path on the server.
          /^[a-z0-9-]{1,60}-(near|far)\.bin$/.test(g.file) &&
          [g.x0, g.z0, g.spacing, g.columns, g.rows, g.offset, g.scale].every(Number.isFinite) &&
          g.spacing > 0 &&
          g.scale > 0 &&
          Number.isInteger(g.columns) &&
          Number.isInteger(g.rows) &&
          g.columns >= 2 &&
          g.rows >= 2 &&
          g.columns * g.rows <= 4_000_000,
      ))
  )
    throw new Error('Invalid real-road data');
}
export const routeLength = (route: Route) => route.points.at(-1)!.meters;
/** Distance determines terrain; shifting and pacing never change where a hill is. */
export function routePosition(route: Route, meters: number) {
  const distance = Math.max(0, Math.min(routeLength(route), meters));
  let elevation = 0,
    ascent = 0,
    grade = route.points[0].grade;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1],
      b = route.points[i];
    if (distance <= a.meters) break;
    const span = Math.min(distance, b.meters) - a.meters;
    grade = a.grade + ((b.grade - a.grade) * span) / (b.meters - a.meters);
    elevation += (span * (a.grade + grade)) / 200;
    if (a.grade >= 0 && grade >= 0) ascent += (span * (a.grade + grade)) / 200;
    else if (a.grade > 0 || grade > 0)
      ascent += (span * Math.max(a.grade, grade) ** 2) / (Math.abs(a.grade - grade) * 200);
    if (distance <= b.meters) break;
  }
  return {
    grade,
    elevation,
    ascent,
    remaining: routeLength(route) - distance,
    progress: distance / routeLength(route),
  };
}
