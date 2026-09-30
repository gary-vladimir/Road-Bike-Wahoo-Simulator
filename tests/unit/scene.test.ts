import { describe, expect, it } from 'vitest';
import { routeCourse } from '../../src/ride/course';
import { routes } from '../../src/ride/terrain';
import {
  blendedHeight,
  corridor,
  groundColor,
  nearRoad,
  proceduralGround,
} from '../../src/scene/ground';
import { buildTile, tileSize } from '../../src/scene/tiles';
import { simplex2, hash2 } from '../../src/scene/noise';

const course = routeCourse(routes.find((r) => r.id === 'ascent')!);
course.ensure(5000);
const ground = proceduralGround(course);

describe('terrain around the road', () => {
  it('lies flat just under the road and rejoins natural terrain farther out', () => {
    for (const s of [300, 1600, 3000]) {
      const side = course.offset(s, 3),
        far = course.offset(s, 400);
      const road = nearRoad(course, side.x - 1, side.z - 1, side.x + 1, side.z + 1);
      const under = blendedHeight(ground.natural(side.x, side.z), road(side.x, side.z));
      expect(under).toBeCloseTo(course.elevation(s) - 0.14, 1);
      const away = nearRoad(course, far.x - 1, far.z - 1, far.x + 1, far.z + 1);
      expect(blendedHeight(ground.natural(far.x, far.z), away(far.x, far.z))).toBe(
        ground.natural(far.x, far.z),
      );
    }
  });

  it('builds seamless tiles: shared edges have identical heights at every detail level', () => {
    const start = course.offset(1200, 0);
    const tx = Math.floor(start.x / tileSize),
      tz = Math.floor(start.z / tileSize);
    for (const level of [0, 1]) {
      const a = buildTile(course, ground, tx, tz, level, false).geometry;
      const b = buildTile(course, ground, tx + 1, tz, level, false).geometry;
      const pa = a.getAttribute('position'),
        pb = b.getAttribute('position');
      // 4 m and 8 m grid spacing across a 256 m tile.
      const n = level === 0 ? 64 : 32;
      for (let j = 0; j <= n; j++) {
        const right = j * (n + 1) + n,
          left = j * (n + 1);
        expect(pa.getX(right)).toBeCloseTo(pb.getX(left), 6);
        expect(pa.getY(right)).toBeCloseTo(pb.getY(left), 6);
        expect(pa.getZ(right)).toBeCloseTo(pb.getZ(left), 6);
      }
      for (let i = 0; i < pa.count; i++) expect(Number.isFinite(pa.getY(i))).toBe(true);
    }
  });

  it('keeps trees, cacti and rocks off the road and its shoulders', () => {
    const start = course.offset(2000, 0);
    const tx = Math.floor(start.x / tileSize),
      tz = Math.floor(start.z / tileSize);
    const { props } = buildTile(course, ground, tx, tz, 0, true);
    expect(props.length).toBeGreaterThan(100);
    const road = nearRoad(
      course,
      tx * tileSize,
      tz * tileSize,
      (tx + 1) * tileSize,
      (tz + 1) * tileSize,
    );
    for (const p of props) {
      if (p.kind === 'post') continue;
      const hit = road(p.x, p.z);
      if (hit) expect(hit.distance).toBeGreaterThan(corridor);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Deterministic: the same tile scatters the same props.
    const again = buildTile(course, ground, tx, tz, 0, true).props;
    expect(again).toEqual(props);
  });

  it('produces bounded noise, stable hashes and valid colors', () => {
    const n = simplex2(3);
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const v = n(i * 0.37, i * 0.11);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThan(-1.01);
    expect(hi).toBeLessThan(1.01);
    expect(hi - lo).toBeGreaterThan(1);
    expect(hash2(12, -4, 1)).toBe(hash2(12, -4, 1));
    expect(hash2(12, -4, 1)).not.toBe(hash2(12, -4, 2));
    const rgb = [0, 0, 0];
    groundColor(10, 20, 1600, 1550, 0.3, 50, rgb);
    for (const c of rgb) {
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThan(1);
    }
  });
});
