import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { realRoads } from '../../src/ride/catalog';
import { routeCourse } from '../../src/ride/course';
import { routeLength, routePosition, validateRoute } from '../../src/ride/terrain';
import { gridGround } from '../../src/scene/ground';

describe('real Oaxaca roads', () => {
  it('ship consistent geometry, profiles and terrain files', () => {
    expect(realRoads.map((r) => r.id)).toEqual([
      'monte-alban',
      'san-felipe',
      'tule-mitla',
      'teotitlan',
    ]);
    for (const road of realRoads) {
      const length = routeLength(road);
      expect((road.path!.length - 1) * road.pathStep!).toBe(length);
      // The Oaxaca valley and its foothills.
      expect(road.startElevation).toBeGreaterThan(1400);
      expect(road.startElevation).toBeLessThan(2200);
      for (const p of road.points) expect(Math.abs(p.grade)).toBeLessThanOrEqual(18);
      expect(road.attribution).toContain('OpenStreetMap');
      for (const grid of [road.terrain!.near, road.terrain!.far]) {
        const bytes = statSync(`public/routes/${grid.file}`).size;
        expect(bytes).toBe(grid.columns * grid.rows * 2);
      }
    }
  });

  it('match their known climbs', () => {
    const climb = (id: string) => {
      const road = realRoads.find((r) => r.id === id)!;
      return routePosition(road, routeLength(road)).ascent;
    };
    // Monte Albán gains roughly 350 m from the city to the ruins.
    expect(climb('monte-alban')).toBeGreaterThan(330);
    expect(climb('monte-alban')).toBeLessThan(450);
    expect(climb('teotitlan')).toBeLessThan(120);
  });

  it('build a course that follows the road polyline', () => {
    const road = realRoads.find((r) => r.id === 'monte-alban')!;
    const course = routeCourse(road);
    course.ensure(routeLength(road));
    for (const i of [0, 150, 600, road.path!.length - 1]) {
      const p = course.point(i * road.pathStep!);
      expect(Math.hypot(p.x - road.path![i][0], p.z - road.path![i][1])).toBeLessThan(0.5);
    }
    expect(course.elevation(routeLength(road)) - road.startElevation!).toBeCloseTo(
      routePosition(road, routeLength(road)).elevation,
      0,
    );
  });

  it('rejects terrain files outside BikeSIM’s own height data', () => {
    const road = structuredClone(realRoads[0]);
    road.terrain!.near.file = '../../token.txt';
    expect(() => validateRoute(road)).toThrow('Invalid real-road data');
  });
});

describe('grid terrain', () => {
  it('samples heights bilinearly and fades into the coarse grid at the edge', () => {
    const grid = (spacing: number, columns: number, base: number) => ({
      grid: {
        file: 'x-near.bin',
        x0: -((columns - 1) * spacing) / 2,
        z0: -((columns - 1) * spacing) / 2,
        spacing,
        columns,
        rows: columns,
        offset: base,
        scale: 0.1,
      },
      heights: new Uint16Array(columns * columns).fill(1000),
    });
    const near = grid(25, 81, 1500),
      far = grid(200, 41, 1400);
    const ground = gridGround(near, far, 1550);
    // Deep inside the detailed grid: its 1600 m, plus ±1.2 m of detail noise.
    expect(Math.abs(ground.natural(0, 0) - 1600)).toBeLessThan(1.3);
    // Beyond it: the coarse grid's 1500 m.
    expect(Math.abs(ground.natural(1500, 0) - 1500)).toBeLessThan(1.3);
    // Outside both: the fallback.
    expect(Math.abs(ground.natural(20000, 0) - 1550)).toBeLessThan(1.3);
    // Continuous across the detailed grid's edge.
    const edge = near.grid.x0 + (near.grid.columns - 1) * near.grid.spacing;
    expect(Math.abs(ground.natural(edge - 0.01, 0) - ground.natural(edge + 0.01, 0))).toBeLessThan(
      0.1,
    );
  });
});
