import { routeLength, type Route } from './terrain';
import { advance, oaxacaAltitude, type PhysicsSetup } from './physics';

/** Meters between road samples. */
export const courseStep = 2;
const cell = 16;

/** Generates a course's centerline and grade for increasing distance. */
export interface CourseSource {
  place(meters: number): { x: number; z: number };
  grade(meters: number): number;
}

/**
 * The road in world space: centerline (x east, z south; rides start heading north, −z) and
 * absolute elevation, sampled every 2 m. Physics reads its grade; the scene builds the road,
 * terrain and camera from it. Endless courses (workouts) extend as the rider advances.
 */
export class Course {
  readonly xs: number[] = [];
  readonly zs: number[] = [];
  readonly ys: number[] = [];
  readonly grades: number[] = [];
  private grid = new Map<number, number[]>();
  constructor(
    /** Meters, or Infinity for an endless road. */
    readonly length: number,
    startElevation: number,
    private source: CourseSource,
  ) {
    const start = source.place(0);
    this.xs.push(start.x);
    this.zs.push(start.z);
    this.ys.push(startElevation);
    this.grades.push(source.grade(0));
    this.index(0);
  }

  /** Meters of road generated so far. */
  get generated() {
    return (this.xs.length - 1) * courseStep;
  }

  /** Generate samples up to `meters` (bounded by the course length), 200 m at a time. */
  ensure(meters: number) {
    if (meters <= this.generated) return;
    const until = Math.min(Math.ceil(meters / 200) * 200, this.length);
    while (this.generated < until) {
      const i = this.xs.length,
        s = i * courseStep;
      const p = this.source.place(s);
      const grade = Math.max(-25, Math.min(25, this.source.grade(s)));
      this.xs.push(p.x);
      this.zs.push(p.z);
      // Trapezoidal integration of grade matches the physics' linear-grade profile.
      this.ys.push(this.ys[i - 1] + ((this.grades[i - 1] + grade) / 200) * courseStep);
      this.grades.push(grade);
      this.index(i);
    }
  }

  private index(i: number) {
    const key = this.key(Math.floor(this.xs[i] / cell), Math.floor(this.zs[i] / cell));
    const bucket = this.grid.get(key);
    if (bucket) bucket.push(i);
    else this.grid.set(key, [i]);
  }
  private key(cx: number, cz: number) {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
  private at(meters: number) {
    const s = Math.max(0, Math.min(meters, this.length));
    this.ensure(s + courseStep);
    const f = s / courseStep,
      i = Math.max(0, Math.min(Math.floor(f), this.xs.length - 2)),
      t = Math.min(1, f - i);
    return { i, t };
  }
  point(meters: number) {
    const { i, t } = this.at(meters);
    return {
      x: this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t,
      z: this.zs[i] + (this.zs[i + 1] - this.zs[i]) * t,
    };
  }
  elevation(meters: number) {
    const { i, t } = this.at(meters);
    return this.ys[i] + (this.ys[i + 1] - this.ys[i]) * t;
  }
  grade(meters: number) {
    const { i, t } = this.at(meters);
    return this.grades[i] + (this.grades[i + 1] - this.grades[i]) * t;
  }
  /** Unit direction of travel. */
  direction(meters: number) {
    const a = this.point(Math.max(0, meters - courseStep)),
      b = this.point(meters + courseStep);
    const dx = b.x - a.x,
      dz = b.z - a.z,
      n = Math.hypot(dx, dz) || 1;
    return { x: dx / n, z: dz / n };
  }
  /** Signed curvature in 1/m (positive turns right, i.e. clockwise seen from above). */
  curvature(meters: number, span = 12) {
    const a = this.direction(meters - span),
      b = this.direction(meters + span);
    return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z) / (2 * span);
  }
  /** A point `lateral` meters right of the centerline, at road elevation. */
  offset(meters: number, lateral: number) {
    const p = this.point(meters),
      d = this.direction(meters);
    return { x: p.x - d.z * lateral, y: this.elevation(meters), z: p.z + d.x * lateral };
  }

  /**
   * The nearest generated road point within `radius` meters of (x, z): distance along the
   * road, horizontal distance from the centerline and road elevation. Null when none is close.
   */
  nearest(x: number, z: number, radius: number) {
    const cx = Math.floor(x / cell),
      cz = Math.floor(z / cell),
      r = Math.ceil(radius / cell);
    let best = -1,
      bestD = radius * radius;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const bucket = this.grid.get(this.key(ix, iz));
        if (!bucket) continue;
        for (const i of bucket) {
          const dx = this.xs[i] - x,
            dz = this.zs[i] - z,
            d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    if (best < 0) return null;
    // Refine onto the neighboring segments for a smooth distance field.
    let s = best * courseStep,
      dist = Math.sqrt(bestD);
    for (const j of [best - 1, best]) {
      if (j < 0 || j + 1 >= this.xs.length) continue;
      const ax = this.xs[j],
        az = this.zs[j],
        bx = this.xs[j + 1] - ax,
        bz = this.zs[j + 1] - az;
      const len = bx * bx + bz * bz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / len));
      const d = Math.hypot(ax + bx * t - x, az + bz * t - z);
      if (d < dist) {
        dist = d;
        s = (j + t) * courseStep;
      }
    }
    return { s, distance: dist, y: this.elevation(s) };
  }
}

/** Gentle procedural bends: the heading is a sum of slow sinusoids, integrated into a path. */
export function bendingPlacer(seed = 0, amount = 1) {
  const phase = seed * 1.7;
  let x = 0,
    z = 0,
    last = 0;
  return (meters: number) => {
    const heading =
      amount *
      (0.36 * Math.sin(meters / 260 + phase) +
        0.2 * Math.sin(meters / 97 + phase * 2.3) +
        0.08 * Math.sin(meters / 41 + phase * 0.7));
    const ds = meters - last;
    last = meters;
    x += Math.sin(heading) * ds;
    z -= Math.cos(heading) * ds;
    return { x, z };
  };
}

/** Grade along a route profile, evaluated incrementally for increasing distance. */
export function profileGrade(route: Route) {
  let k = 0;
  const pts = route.points;
  return (meters: number) => {
    const s = Math.min(meters, pts.at(-1)!.meters);
    while (k < pts.length - 2 && s > pts[k + 1].meters) k++;
    while (k > 0 && s < pts[k].meters) k--;
    const a = pts[k],
      b = pts[Math.min(k + 1, pts.length - 1)];
    return b.meters === a.meters
      ? a.grade
      : a.grade + ((b.grade - a.grade) * (s - a.meters)) / (b.meters - a.meters);
  };
}

/** A real road's polyline (every `pathStep` m), smoothed with a Catmull-Rom spline. */
export function pathPlacer(path: [number, number][], step: number) {
  return (meters: number) => {
    const f = Math.max(0, Math.min(path.length - 1, meters / step));
    const i = Math.min(Math.floor(f), path.length - 2),
      t = f - i;
    const p0 = path[Math.max(0, i - 1)],
      p1 = path[i],
      p2 = path[i + 1],
      p3 = path[Math.min(path.length - 1, i + 2)];
    const cr = (a: number, b: number, c: number, d: number) =>
      0.5 *
      (2 * b +
        (-a + c) * t +
        (2 * a - 5 * b + 4 * c - d) * t * t +
        (-a + 3 * b - 3 * c + d) * t ** 3);
    return { x: cr(p0[0], p1[0], p2[0], p3[0]), z: cr(p0[1], p1[1], p2[1], p3[1]) };
  };
}

export function routeCourse(route: Route) {
  const source: CourseSource = {
    place: route.path?.length
      ? pathPlacer(route.path, route.pathStep ?? 10)
      : bendingPlacer(route.id.length),
    grade: profileGrade(route),
  };
  return new Course(routeLength(route), route.startElevation ?? oaxacaAltitude, source);
}

export type RiderState = { elapsed: number; distance: number; speed: number; bias: number };

/**
 * Plans an endless workout road: climbs start where the rider is predicted to be when each
 * hard interval starts. Each extension resyncs the prediction from the rider's actual state;
 * road that already exists never changes.
 */
class WorkoutPlanner implements CourseSource {
  course?: Course;
  private simT = 0;
  private simS = 0;
  private simV = 0;
  private bias = 1;
  private smoothed = 0;
  private place_ = bendingPlacer(3, 0.8);
  constructor(
    private targetWatts: (elapsed: number, bias: number) => number,
    private blockGrade: (elapsed: number) => number,
    private setup: PhysicsSetup,
    private state: () => RiderState,
  ) {}
  place(meters: number) {
    return this.place_(meters);
  }
  resync() {
    const now = this.state();
    this.simT = now.elapsed;
    this.simS = now.distance * 1000;
    this.simV = now.speed;
    this.bias = now.bias;
  }
  private simulateTo(meters: number) {
    for (let guard = 0; this.simS < meters && guard < 50000; guard++) {
      // Read existing grades directly: the public accessors could re-enter generation.
      const i = Math.floor(this.simS / courseStep);
      const grade =
        this.course && i < this.course.grades.length ? this.course.grades[i] : this.smoothed;
      const power = Math.max(0, this.targetWatts(this.simT, this.bias));
      const step = advance(Math.min(this.simV, 149), power, grade, this.setup, 0.5);
      // A stalled prediction (0 W) still has to reach the frontier: assume walking pace.
      this.simV = Math.max(step.speed, 10);
      this.simS += Math.max(step.distance, (10 / 3.6) * 0.5);
      this.simT += 0.5;
    }
  }
  grade(meters: number) {
    if (!this.course) return 0;
    this.simulateTo(meters);
    // Ease toward the interval's visual grade over roughly 60 m.
    const goal = this.blockGrade(this.simT);
    this.smoothed += (goal - this.smoothed) * (1 - Math.exp(-courseStep / 60));
    return this.smoothed;
  }
}

export class WorkoutCourse extends Course {
  private planner: WorkoutPlanner;
  constructor(
    targetWatts: (elapsed: number, bias: number) => number,
    blockGrade: (elapsed: number) => number,
    setup: PhysicsSetup,
    state: () => RiderState,
  ) {
    const planner = new WorkoutPlanner(targetWatts, blockGrade, setup, state);
    super(Infinity, oaxacaAltitude, planner);
    planner.course = this;
    this.planner = planner;
  }
  ensure(meters: number) {
    if (meters > this.generated) this.planner.resync();
    super.ensure(meters);
  }
}
