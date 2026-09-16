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
  // Unknown crank torque/gearing at walking pace: bound the power-to-force conversion.
  minimumDriveSpeed: 0.75,
};
// Forces in newtons; gravity is positive downhill, air/rolling oppose forward travel.
function forcesAt(v: number, power: number, mass: number, angle: number) {
  const relativeAir = v + roadPhysics.windSpeed;
  const gravity = -mass * 9.81 * Math.sin(angle);
  const rolling = mass * 9.81 * roadPhysics.rollingResistance * Math.cos(angle);
  const air = roadPhysics.windResistance * relativeAir * Math.abs(relativeAir);
  const drive =
    (Math.max(0, power) * roadPhysics.efficiency) / Math.max(v, roadPhysics.minimumDriveSpeed);
  return { gravity, rolling, air, drive, acceleration: (drive + gravity - rolling - air) / mass };
}

/** The same instantaneous force balance used by the integrator; speed is in km/h. */
export function roadForces(
  speed: number,
  power: number,
  grade: number,
  riderMass: number,
  bikeMass: number,
) {
  return forcesAt(speed / 3.6, power, riderMass + bikeMass, Math.atan(grade / 100));
}

export function coastStatus(speed: number, grade: number, riderMass: number, bikeMass: number) {
  const { acceleration } = roadForces(speed, 0, grade, riderMass, bikeMass);
  if (speed <= 0.1 && acceleration <= 0)
    return { trend: 'Stopped', explanation: 'Pedal to overcome the road load.' };
  if (Math.abs(acceleration) < 0.005)
    return { trend: 'Steady speed', explanation: 'Gravity and drag are nearly balanced.' };
  if (acceleration > 0)
    return { trend: 'Gaining speed', explanation: 'Gravity exceeds rolling and air drag.' };
  return {
    trend: 'Slowing down',
    explanation:
      grade < 0
        ? 'Still moving downhill; rolling and air drag exceed gravity.'
        : grade > 0
          ? 'Climbing and drag use up your momentum.'
          : 'Rolling and air drag use up your momentum.',
  };
}

export function advanceRoad(
  speed: number,
  power: number,
  grade: number,
  riderMass: number,
  bikeMass: number,
  seconds: number,
) {
  if (
    ![speed, power, grade, riderMass, bikeMass, seconds].every(Number.isFinite) ||
    speed < 0 ||
    speed > 150 ||
    Math.abs(grade) > 30 ||
    riderMass < 35 ||
    riderMass > 200 ||
    bikeMass < 4 ||
    bikeMass > 30 ||
    seconds < 0 ||
    seconds > 2.5
  )
    throw new Error('Road physics input is outside supported limits');
  let v = speed / 3.6,
    distance = 0;
  const mass = riderMass + bikeMass,
    angle = Math.atan(grade / 100);
  // Integrate at <=10 ms regardless of render frequency. Small steps retain momentum,
  // reach a drag-limited downhill speed, and resolve stopping within a step.
  const steps = Math.max(1, Math.ceil(seconds / 0.01)),
    dt = seconds / steps;
  for (let i = 0; i < steps; i++) {
    const { acceleration } = forcesAt(v, power, mass, angle);
    const stopTime = acceleration < 0 && v + acceleration * dt < 0 ? v / -acceleration : dt;
    const next = Math.min(150 / 3.6, Math.max(0, v + acceleration * stopTime));
    distance += (v + next) * 0.5 * stopTime;
    v = next;
    // Forward-only riding: once an uphill coast stops, don't roll backward or add distance.
    if (stopTime < dt) break;
  }
  return { speed: v * 3.6, distance: distance / 1000 };
}
