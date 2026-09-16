import { describe, expect, it } from 'vitest';
import { Euler, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { routes } from '../../src/ride/terrain';
import { terrainGeometry } from '../../src/scene/landscape';
import {
  contactGeometry,
  panoramaGeometry,
  railOrientation,
  terrainSampler,
} from '../../src/scene/scenery';

describe('scenery depth and placement', () => {
  it('places objects on the actual terrain triangles at either graphics quality', () => {
    for (const low of [false, true]) {
      const ground = terrainGeometry(2240, 1440, routes[3], low);
      const material = new MeshBasicMaterial();
      const mesh = new Mesh(ground, material);
      const sample = terrainSampler(ground);
      for (const s of [2263, 2401, 2517]) {
        for (const lateral of [-80, -11, 7.2, 55]) {
          const point = sample(s, lateral);
          const ray = new Raycaster(
            point.clone().add(new Vector3(0, 100, 0)),
            new Vector3(0, -1, 0),
          );
          const hit = ray.intersectObject(mesh)[0];
          expect(hit).toBeDefined();
          expect(hit.point.distanceTo(point)).toBeLessThan(0.0001);
        }
      }
      ground.dispose();
      material.dispose();
    }
  });

  it('drapes contact shading on matching ground triangles, rather than a flat hovering disc', () => {
    const ground = terrainGeometry(2240, 1440, routes[3], true);
    const shade = contactGeometry(ground, [{ meters: 2401, lateral: 55, radius: 5 }]);
    const positions = shade.getAttribute('position');
    const source = ground.getAttribute('position');
    const vertices = new Map<string, number>();
    for (let i = 0; i < source.count; i++)
      vertices.set(`${source.getX(i)},${source.getZ(i)}`, source.getY(i));
    expect(positions.count).toBeGreaterThan(0);
    for (let i = 0; i < positions.count; i++) {
      const y = vertices.get(`${positions.getX(i)},${positions.getZ(i)}`);
      expect(y).toBeDefined();
      expect(positions.getY(i) - y!).toBeCloseTo(0.008, 4);
    }
    ground.dispose();
    shade.dispose();
  });

  it('joins both fence posts exactly on uphill and downhill spans', () => {
    for (const b of [new Vector3(2, 4, -8), new Vector3(-3, -2, -8)]) {
      const a = new Vector3(-1, 0.7, 1);
      const orientation = railOrientation(a, b);
      const matrix = new Matrix4().makeRotationFromEuler(
        new Euler(0, orientation.rotation, orientation.tilt),
      );
      const end = new Vector3(a.distanceTo(b), 0, 0).applyMatrix4(matrix).add(a);
      expect(end.distanceTo(b)).toBeLessThan(1e-10);
    }
  });

  it('covers the road view with a world-oriented dome and continuous texture coordinates', () => {
    const dome = panoramaGeometry();
    const points = dome.getAttribute('position'),
      uv = dome.getAttribute('uv');
    for (let i = 0; i < points.count; i++) {
      expect(new Vector3().fromBufferAttribute(points, i).length()).toBeCloseTo(2600, 2);
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
    const mesh = new Mesh(dome, new MeshBasicMaterial());
    for (const yaw of [-0.8, 0, 0.8]) {
      const direction = new Vector3(Math.sin(yaw), 0.15, -Math.cos(yaw)).normalize();
      // A ray on a shared triangle edge may legitimately return both faces.
      expect(new Raycaster(new Vector3(), direction).intersectObject(mesh).length).toBeGreaterThan(
        0,
      );
    }
    dome.dispose();
    mesh.material.dispose();
  });
});
