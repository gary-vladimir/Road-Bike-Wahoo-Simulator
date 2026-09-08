export type Route = {
  id: string;
  name: string;
  description: string;
  points: { meters: number; grade: number }[];
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
    route.points.length > 1000
  )
    throw new Error('Invalid route');
  route.points.forEach((p, i) => {
    if (
      !p ||
      !Number.isFinite(p.meters) ||
      !Number.isFinite(p.grade) ||
      Math.abs(p.grade) > 6 ||
      (i === 0 ? p.meters !== 0 : p.meters <= route.points[i - 1].meters)
    )
      throw new Error('Invalid route profile');
  });
  if (routeLength(route) < 100 || routeLength(route) > 200000)
    throw new Error('Route distance out of range');
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
export const roadPhysics = {
  rollingResistance: 0.004,
  windResistance: 0.18,
  windSpeed: 0,
  efficiency: 0.97,
};
export function advanceRoad(
  speed: number,
  power: number,
  grade: number,
  riderMass: number,
  bikeMass: number,
  seconds: number,
) {
  const v = speed / 3.6,
    mass = riderMass + bikeMass;
  const angle = Math.atan(grade / 100),
    relativeAir = v + roadPhysics.windSpeed;
  const resistance =
    mass * 9.81 * (roadPhysics.rollingResistance * Math.cos(angle) + Math.sin(angle)) +
    roadPhysics.windResistance * relativeAir * Math.abs(relativeAir);
  const force = (Math.max(0, power) * roadPhysics.efficiency) / Math.max(v, 2);
  const next = Math.min(25, Math.max(0, v + ((force - resistance) / mass) * seconds));
  return { speed: next * 3.6, distance: ((v + next) * 0.5 * seconds) / 1000 };
}
