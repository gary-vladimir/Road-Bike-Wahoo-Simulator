import { describe, expect, it } from 'vitest';
import { Course, courseStep, pathPlacer, routeCourse } from '../../src/ride/course';
import { RideEngine, cornerSpeed } from '../../src/ride/engine';
import { routes, routePosition, type Route } from '../../src/ride/terrain';
import { position, presets } from '../../src/workouts/model';

describe('course geometry', () => {
  it('matches the physics elevation profile of a road', () => {
    const route = routes.find((r) => r.id === 'foothills')!;
    const course = routeCourse(route);
    course.ensure(6000);
    for (const m of [0, 400, 1600, 2300, 3900, 5300, 6000])
      expect(course.elevation(m) - course.elevation(0)).toBeCloseTo(
        routePosition(route, m).elevation,
        1,
      );
    expect(course.grade(1600)).toBeCloseTo(4, 5);
    expect(course.generated).toBe(6000);
  });

  it('spaces samples evenly along a bending road and finds the nearest point', () => {
    const course = routeCourse(routes[0]);
    course.ensure(3000);
    for (let i = 1; i < course.xs.length; i += 97)
      expect(
        Math.hypot(course.xs[i] - course.xs[i - 1], course.zs[i] - course.zs[i - 1]),
      ).toBeCloseTo(courseStep, 3);
    const side = course.offset(1234, 10);
    const near = course.nearest(side.x, side.z, 40)!;
    expect(near.s).toBeCloseTo(1234, 0);
    expect(near.distance).toBeCloseTo(10, 1);
    expect(course.nearest(side.x + 500, side.z, 40)).toBeNull();
  });

  it('follows a real polyline smoothly through its points', () => {
    const path: [number, number][] = Array.from({ length: 41 }, (_, i) => [
      Math.sin(i / 6) * 40,
      -i * 10,
    ]);
    const place = pathPlacer(path, 10);
    for (const i of [0, 7, 20, 40]) {
      const p = place(i * 10);
      expect(p.x).toBeCloseTo(path[i][0], 6);
      expect(p.z).toBeCloseTo(path[i][1], 6);
    }
    const route: Route = {
      id: 'polyline',
      name: 'Polyline',
      description: '',
      points: [
        { meters: 0, grade: 2 },
        { meters: 400, grade: 2 },
      ],
      path,
      pathStep: 10,
      startElevation: 1600,
    };
    const course = routeCourse(route);
    expect(course.elevation(0)).toBe(1600);
    expect(course.elevation(400)).toBeCloseTo(1608, 3);
  });

  it('slows riders for hairpins but never for gentle bends', () => {
    expect(cornerSpeed(routeCourse(routes[1]), 1000)).toBe(150);
    // A 12 m radius hairpin: comfortable at about 6.5 m/s (23 km/h).
    const hairpin = new Course(400, 0, {
      place: (m) =>
        m < 100
          ? { x: 0, z: -m }
          : m < 100 + Math.PI * 12
            ? {
                x: 12 - 12 * Math.cos((m - 100) / 12),
                z: -100 - 12 * Math.sin((m - 100) / 12),
              }
            : { x: 24, z: -100 + (m - 100 - Math.PI * 12) },
      grade: () => -6,
    });
    const limit = cornerSpeed(hairpin, 80);
    expect(limit).toBeGreaterThan(20);
    expect(limit).toBeLessThan(28);
  });
});

describe('workout road', () => {
  it('lines climbs up with the hard intervals of the hills workout', () => {
    const hills = presets.find((w) => w.id === 'hills')!;
    const e = new RideEngine(hills, 'demo', 220, 70);
    const grades: { block: string; grade: number }[] = [];
    for (let t = 0; t <= 3000 * 1000 && e.state.phase !== 'finished'; t += 250) {
      e.tick(t);
      e.course.ensure(e.state.distance * 1000 + 2000);
      if (e.state.phase !== 'running') continue;
      const p = position(e.session.workout, e.state.elapsed);
      // Sample the middle of each interval.
      if (Math.abs(p.progress - 0.5) < 0.001 + 0.25 / p.block.seconds)
        grades.push({ block: p.block.name, grade: e.state.grade });
    }
    const climbs = grades.filter((g) => g.block.startsWith('Climb'));
    const valleys = grades.filter((g) => g.block.startsWith('Valley'));
    expect(climbs.length).toBeGreaterThanOrEqual(4);
    for (const c of climbs) expect(c.grade).toBeGreaterThan(3.5);
    for (const v of valleys) expect(v.grade).toBeLessThan(1.5);
    // Generated road never changes once built.
    const before = e.course.elevation(1000);
    e.course.ensure(e.state.distance * 1000 + 4000);
    expect(e.course.elevation(1000)).toBe(before);
  });
});
