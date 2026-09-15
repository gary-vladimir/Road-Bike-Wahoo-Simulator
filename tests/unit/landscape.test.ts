import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { routes, routePosition } from '../../src/ride/terrain';
import {
  groundHeight,
  heading,
  ribbon,
  roadPoint,
  roadWidth,
  terrainGeometry,
} from '../../src/scene/landscape';

describe('road rendering geometry', () => {
  it('keeps both edges perpendicular to the centerline and a constant width through curves and hills', () => {
    for (const route of routes) {
      for (let s = 0; s < 5000; s += 37) {
        const left = roadPoint(s, -roadWidth / 2, route);
        const right = roadPoint(s, roadWidth / 2, route);
        const across = right.clone().sub(left);
        expect(across.length()).toBeCloseTo(roadWidth, 10);
        expect(across.dot(new Vector3(heading(s), 0, -1))).toBeCloseTo(0, 10);
        expect(left.y).toBeCloseTo(routePosition(route, s).elevation, 10);
        const camera = roadPoint(s, 1.65, route, 1.62);
        expect(camera.y - left.y).toBeCloseTo(1.62, 10);
      }
    }
  });

  it('preserves asphalt position and paint phase across a streaming chunk replacement', () => {
    const before = ribbon(80, 1440, roadWidth, routes[1], 0.025);
    const after = ribbon(320, 1440, roadWidth, routes[1], 0.025);
    for (const name of ['position', 'uv', 'normal']) {
      const a = before.getAttribute(name),
        b = after.getAttribute(name);
      // Skip boundary normals; compare the overlapping interior at the same world positions.
      for (let i = 2; i < 1198; i++) {
        for (let axis = 0; axis < a.itemSize; axis++) {
          expect(a.array[(i + 240) * a.itemSize + axis]).toBeCloseTo(
            b.array[i * b.itemSize + axis],
            5,
          );
        }
      }
    }
    before.dispose();
    after.dispose();
  });

  it('keeps painted UV edges continuous and terrain below the road on both quality settings', () => {
    for (const route of routes) {
      for (const low of [true, false]) {
        const terrain = terrainGeometry(80, 1440, route, low);
        const road = ribbon(80, 1440, roadWidth, route, 0.025);
        for (const geometry of [terrain, road]) {
          for (const value of geometry.getAttribute('position').array)
            expect(Number.isFinite(value)).toBe(true);
          const normals = geometry.getAttribute('normal');
          for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0);
        }
        const uv = road.getAttribute('uv');
        for (let i = 0; i < uv.count; i += 2) {
          expect(uv.getX(i)).toBe(0);
          expect(uv.getX(i + 1)).toBe(1);
          expect(uv.getY(i)).toBe(uv.getY(i + 1));
        }
        for (let s = 80; s < 1500; s += 20) {
          for (const lateral of [-4.5, 0, 4.5]) {
            expect(groundHeight(s, lateral, route)).toBeLessThan(roadPoint(s, lateral, route).y);
          }
        }
        terrain.dispose();
        road.dispose();
      }
    }
  });
});
