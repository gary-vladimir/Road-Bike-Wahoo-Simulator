import * as THREE from 'three';
import type { Course } from '../ride/course';
import { blendedHeight, corridor, groundColor, nearRoad, smoothstep, type Ground } from './ground';
import { hash2, simplex2 } from './noise';
import type { Prop } from './props';

export const tileSize = 256;
/** Grid spacing (m) by detail level; a tile's level is its Chebyshev distance in tiles. */
const levels = [
  { spacing: 4, reach: 1 },
  { spacing: 8, reach: 3 },
  { spacing: 32, reach: 6 },
];
const levelFor = (d: number) => levels.findIndex((l) => d <= l.reach);

type Tile = { key: string; tx: number; tz: number; level: number; mesh: THREE.Mesh; props: Prop[] };

const density = simplex2(41);

/** Geometry and scattered props for one terrain tile. */
export function buildTile(
  course: Course,
  ground: Ground,
  tx: number,
  tz: number,
  level: number,
  withProps: boolean,
  /** Low graphics: half the near terrain resolution and sparser props. */
  low = false,
) {
  const spacing = levels[level].spacing * (low && level < 2 ? 2 : 1);
  const n = tileSize / spacing;
  const N = n + 3; // one sample of border on every side, for seamless normals
  const x0 = tx * tileSize,
    z0 = tz * tileSize;
  const road = nearRoad(
    course,
    x0 - spacing,
    z0 - spacing,
    x0 + tileSize + spacing,
    z0 + tileSize + spacing,
  );
  const heights = new Float32Array(N * N),
    distances = new Float32Array(N * N),
    floors = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = x0 + (i - 1) * spacing,
        z = z0 + (j - 1) * spacing;
      const hit = road(x, z);
      const k = j * N + i;
      heights[k] = blendedHeight(ground.natural(x, z), hit);
      distances[k] = hit ? hit.distance : 1e4;
      floors[k] = ground.floor(x, z);
    }
  const count = (n + 1) * (n + 1);
  const skirt = 4 * (n + 1);
  const positions = new Float32Array((count + skirt) * 3),
    normals = new Float32Array((count + skirt) * 3),
    colors = new Float32Array((count + skirt) * 3),
    uvs = new Float32Array((count + skirt) * 2);
  const rgb = [0, 0, 0];
  const at = (i: number, j: number) => heights[(j + 1) * N + (i + 1)];
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      const v = j * (n + 1) + i,
        x = x0 + i * spacing,
        z = z0 + j * spacing,
        y = at(i, j);
      const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * spacing),
        dz = (at(i, j + 1) - at(i, j - 1)) / (2 * spacing);
      const len = Math.hypot(dx, 1, dz);
      positions.set([x, y, z], v * 3);
      normals.set([-dx / len, 1 / len, -dz / len], v * 3);
      groundColor(
        x,
        z,
        y,
        floors[(j + 1) * N + i + 1],
        1 - 1 / len,
        distances[(j + 1) * N + i + 1],
        rgb,
      );
      colors.set(rgb, v * 3);
      uvs.set([x / 7, z / 7], v * 2);
    }
  const indices: number[] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  // Skirts hang below every edge and hide cracks where tiles of different detail meet.
  const edges = [
    Array.from({ length: n + 1 }, (_, i) => i),
    Array.from({ length: n + 1 }, (_, i) => n * (n + 1) + i),
    Array.from({ length: n + 1 }, (_, j) => j * (n + 1)),
    Array.from({ length: n + 1 }, (_, j) => j * (n + 1) + n),
  ];
  let next = count;
  const drop = spacing * 1.5;
  for (const edge of edges) {
    const start = next;
    for (const v of edge) {
      positions.set(
        [positions[v * 3], positions[v * 3 + 1] - drop, positions[v * 3 + 2]],
        next * 3,
      );
      normals.set(normals.subarray(v * 3, v * 3 + 3), next * 3);
      colors.set(colors.subarray(v * 3, v * 3 + 3), next * 3);
      uvs.set(uvs.subarray(v * 2, v * 2 + 2), next * 2);
      next++;
    }
    for (let k = 0; k < edge.length - 1; k++) {
      const a = edge[k],
        b = edge[k + 1],
        c = start + k,
        d = start + k + 1;
      // Both windings: skirts are seen from whichever side the camera is on.
      indices.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const props: Prop[] = [];
  if (withProps) {
    const surface = (x: number, z: number) => {
      const hit = road(x, z);
      const y = blendedHeight(ground.natural(x, z), hit);
      return { y, distance: hit ? hit.distance : 1e4 };
    };
    const slopeAt = (x: number, z: number, _y: number) => {
      const e = 1.5;
      return {
        nx: (surface(x - e, z).y - surface(x + e, z).y) / (2 * e),
        nz: (surface(x, z - e).y - surface(x, z + e).y) / (2 * e),
      };
    };
    const cell = (level === 0 ? 7 : 14) * (low ? 1.6 : 1);
    const cells = tileSize / cell;
    for (let cj = 0; cj < cells; cj++)
      for (let ci = 0; ci < cells; ci++) {
        const gx = Math.round((x0 + ci * cell) / cell),
          gz = Math.round((z0 + cj * cell) / cell);
        const h = hash2(gx, gz, 1);
        const x = x0 + (ci + hash2(gx, gz, 2)) * cell,
          z = z0 + (cj + hash2(gx, gz, 3)) * cell;
        const clump = 0.5 + 0.5 * density(x / 160, z / 160);
        const { y, distance } = surface(x, z);
        if (distance < corridor + 1.2) continue;
        const rotation = hash2(gx, gz, 4) * Math.PI * 2;
        const size = hash2(gx, gz, 5);
        const near = 1 - smoothstep(20, 120, distance);
        if (h < 0.05 + clump * 0.13 && distance > corridor + 4) {
          props.push({ kind: 'tree', x, y: y - 0.1, z, scale: 4.2 + size * 4.2, rotation });
          props.push({
            kind: 'shadow',
            x,
            y,
            z,
            scale: 4 + size * 3,
            rotation: 0,
            ...slopeAt(x, z, y),
          });
        } else if (h < 0.26 && h > 0.2 && clump > 0.35 && distance > corridor + 3) {
          props.push({ kind: 'cactus', x, y: y - 0.05, z, scale: 3.2 + size * 3.6, rotation });
          props.push({
            kind: 'shadow',
            x,
            y,
            z,
            scale: 1 + size * 0.8,
            rotation: 0,
            ...slopeAt(x, z, y),
          });
        } else if (level === 0 && h > 0.3 && h < 0.3 + 0.18 * (0.4 + near)) {
          props.push({ kind: 'agave', x, y, z, scale: 0.55 + size * 0.8, rotation });
        } else if (level === 0 && h > 0.6 && h < 0.63) {
          props.push({
            kind: 'rock',
            x,
            y: y + 0.1,
            z,
            scale: 0.5 + size * 1.6,
            rotation,
            tint: 0.85 + size * 0.3,
          });
        }
        // Grass tufts cluster near the verge on detailed tiles.
        if (level === 0 && distance < 60)
          for (let k = 0; k < (low ? 1 : 3); k++) {
            const gh = hash2(gx * 7 + k, gz * 5 - k, 9);
            if (gh > 0.55) continue;
            const qx = x + (hash2(gx, gz, 10 + k) - 0.5) * cell,
              qz = z + (hash2(gx, gz, 20 + k) - 0.5) * cell;
            const q = surface(qx, qz);
            if (q.distance < corridor + 0.6) continue;
            props.push({
              kind: 'grass',
              x: qx,
              y: q.y,
              z: qz,
              scale: 0.7 + gh * 1.4,
              rotation: gh * 40,
              tint: 0.8 + gh * 0.45,
            });
          }
      }
  }
  return { geometry, props };
}

/**
 * Keeps detailed terrain around the rider and coarser tiles to the horizon. Tiles are built a
 * few per frame within a time budget; a tile changing detail keeps its old mesh until the new
 * one is ready, so no holes appear.
 */
export class TerrainTiles {
  readonly group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private queue: { key: string; tx: number; tz: number; level: number; d: number }[] = [];
  private center = '';
  /** Increments whenever the set of props changes. */
  propsVersion = 0;
  constructor(
    private course: Course,
    private ground: Ground,
    private material: THREE.Material,
    private low = false,
  ) {}

  /** Plan tiles around (x, z); returns true while work remains. */
  update(x: number, z: number, budgetMs: number) {
    const cx = Math.floor(x / tileSize),
      cz = Math.floor(z / tileSize);
    const center = `${cx},${cz}`;
    if (center !== this.center) {
      this.center = center;
      const reach = levels.at(-1)!.reach;
      const wanted = new Set<string>();
      this.queue = [];
      for (let dz = -reach; dz <= reach; dz++)
        for (let dx = -reach; dx <= reach; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dz)),
            level = levelFor(d),
            key = `${cx + dx},${cz + dz}`;
          wanted.add(key);
          if (this.tiles.get(key)?.level !== level)
            this.queue.push({ key, tx: cx + dx, tz: cz + dz, level, d });
        }
      this.queue.sort((a, b) => a.d - b.d);
      for (const [key, tile] of this.tiles)
        if (!wanted.has(key)) {
          this.group.remove(tile.mesh);
          tile.mesh.geometry.dispose();
          this.tiles.delete(key);
          if (tile.props.length) this.propsVersion++;
        }
    }
    const start = performance.now();
    while (this.queue.length && performance.now() - start < budgetMs) {
      const job = this.queue.shift()!;
      const built = buildTile(
        this.course,
        this.ground,
        job.tx,
        job.tz,
        job.level,
        job.level <= 1,
        this.low,
      );
      const mesh = new THREE.Mesh(built.geometry, this.material);
      mesh.matrixAutoUpdate = false;
      const old = this.tiles.get(job.key);
      if (old) {
        this.group.remove(old.mesh);
        old.mesh.geometry.dispose();
      }
      this.group.add(mesh);
      this.tiles.set(job.key, { ...job, mesh, props: built.props });
      this.propsVersion++;
    }
    return this.queue.length > 0;
  }

  *props() {
    for (const tile of this.tiles.values()) yield* tile.props;
  }

  dispose() {
    for (const tile of this.tiles.values()) tile.mesh.geometry.dispose();
    this.tiles.clear();
  }
}
