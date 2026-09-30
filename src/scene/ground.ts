import { Course, courseStep } from '../ride/course';
import type { TerrainGrid } from '../ride/terrain';
import { simplex2 } from './noise';

export const roadHalfWidth = 3.6;
/**
 * Terrain is flattened under the road, its shoulders and their edge strip out to this
 * distance; wide enough that coarse terrain triangles never rise through the shoulder.
 */
export const corridor = roadHalfWidth + 3.4;
/** How far the flattened terrain sits below the road surface. */
export const roadBed = 0.3;
/** Widest cut-and-fill blend between the road and the natural terrain. */
export const maxBlend = 95;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Natural terrain before the road is cut in. */
export interface Ground {
  natural(x: number, z: number): number;
  /** Elevation of the valley floor near (x, z): terrain color depends on height above it. */
  floor(x: number, z: number): number;
}

/**
 * A valley that follows the road with rolling hills beside it and ridges farther away.
 * Procedural and workout courses head roughly north (−z), so the road's position and elevation
 * at a given z locate the valley floor.
 */
export function proceduralGround(course: Course, seed = 7): Ground {
  const n1 = simplex2(seed),
    n2 = simplex2(seed + 11),
    n3 = simplex2(seed + 23);
  const along = (z: number) => {
    // Course z decreases monotonically for these gently bending roads: binary search.
    const zs = course.zs;
    let lo = 0,
      hi = zs.length - 1;
    if (z >= zs[0]) return 0;
    if (z <= zs[hi]) return hi * courseStep;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (zs[mid] > z) lo = mid;
      else hi = mid;
    }
    const t = (zs[lo] - z) / (zs[lo] - zs[hi] || 1);
    return (lo + t) * courseStep;
  };
  const floorAt = (x: number, z: number) => {
    const s = along(z);
    const i = Math.min(course.xs.length - 1, Math.round(s / courseStep));
    return { y: course.ys[i], lateral: Math.abs(x - course.xs[i]) };
  };
  return {
    floor: (x, z) => floorAt(x, z).y,
    natural(x, z) {
      const { y, lateral } = floorAt(x, z);
      const valley = smoothstep(20, 900, lateral);
      const hills =
        13 * n1(x / 430, z / 430) + 5.5 * n2(x / 150, z / 150) + 1.4 * n3(x / 36, z / 36);
      const ridge = 0.5 + 0.5 * n1(x / 1900 + 7.3, z / 1900 - 3.1);
      // The sierra: ranges a few kilometers out, rising up to ~1,200 m above the valley.
      const range = smoothstep(600, 5200, lateral) * (380 + 820 * ridge);
      return y - 1 + hills * (0.3 + 0.7 * valley) + valley * (30 + 120 * ridge) + range;
    },
  };
}

/** Bilinear height from a packed grid, or undefined outside it. */
function sampleGrid(grid: TerrainGrid, heights: Uint16Array, x: number, z: number) {
  const fx = (x - grid.x0) / grid.spacing,
    fz = (z - grid.z0) / grid.spacing;
  if (fx < 0 || fz < 0 || fx > grid.columns - 1 || fz > grid.rows - 1) return undefined;
  const i = Math.min(grid.columns - 2, Math.floor(fx)),
    j = Math.min(grid.rows - 2, Math.floor(fz));
  const u = fx - i,
    v = fz - j,
    c = grid.columns;
  const a = heights[j * c + i],
    b = heights[j * c + i + 1],
    d = heights[(j + 1) * c + i],
    e = heights[(j + 1) * c + i + 1];
  return grid.offset + grid.scale * ((a * (1 - u) + b * u) * (1 - v) + (d * (1 - u) + e * u) * v);
}

/**
 * A real road's terrain: a detailed height grid near the road blended into a coarse one out to
 * the horizon, with a little fine noise so flat ground is not glassy.
 */
export function gridGround(
  near: { grid: TerrainGrid; heights: Uint16Array },
  far: { grid: TerrainGrid; heights: Uint16Array },
  fallback: number,
): Ground {
  const detail = simplex2(5);
  const x1 = near.grid.x0 + (near.grid.columns - 1) * near.grid.spacing,
    z1 = near.grid.z0 + (near.grid.rows - 1) * near.grid.spacing;
  const broad = (x: number, z: number) => sampleGrid(far.grid, far.heights, x, z) ?? fallback;
  const blended = (x: number, z: number) => {
    const n = sampleGrid(near.grid, near.heights, x, z),
      f = broad(x, z);
    if (n === undefined) return f;
    // Fade into the coarse grid across the last 400 m of detailed coverage.
    const edge = Math.min(x - near.grid.x0, x1 - x, z - near.grid.z0, z1 - z);
    return f + (n - f) * smoothstep(0, 400, edge);
  };
  return {
    floor: broad,
    natural: (x, z) => blended(x, z) + 1.2 * detail(x / 40, z / 40),
  };
}

export type RoadHit = { s: number; distance: number; y: number };

/** Road samples near an area, for many nearby height queries (one terrain tile). */
export function nearRoad(course: Course, x0: number, z0: number, x1: number, z1: number) {
  const pad = corridor + maxBlend;
  const ids: number[] = [];
  const xs = course.xs,
    zs = course.zs;
  for (let i = 0; i < xs.length; i++)
    if (xs[i] >= x0 - pad && xs[i] <= x1 + pad && zs[i] >= z0 - pad && zs[i] <= z1 + pad)
      ids.push(i);
  // Compact copies keep the per-vertex scan in fast typed arrays.
  const cx = Float64Array.from(ids, (i) => xs[i]),
    cz = Float64Array.from(ids, (i) => zs[i]);
  return (x: number, z: number): RoadHit | null => {
    let best = -1,
      bestD = pad * pad;
    for (let k = 0; k < cx.length; k++) {
      const dx = cx[k] - x,
        dz = cz[k] - z,
        d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best < 0) return null;
    const index = ids[best];
    let s = index * courseStep,
      dist = Math.sqrt(bestD);
    for (const j of [index - 1, index]) {
      if (j < 0 || j + 1 >= xs.length) continue;
      const ax = xs[j],
        az = zs[j],
        bx = xs[j + 1] - ax,
        bz = zs[j + 1] - az;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz || 1), 0, 1);
      const d = Math.hypot(ax + bx * t - x, az + bz * t - z);
      if (d < dist) {
        dist = d;
        s = (j + t) * courseStep;
      }
    }
    const i = Math.min(Math.floor(s / courseStep), course.ys.length - 1),
      t = s / courseStep - i;
    const y = course.ys[i] + ((course.ys[i + 1] ?? course.ys[i]) - course.ys[i]) * t;
    return { s, distance: dist, y };
  };
}

/**
 * Terrain height with the road cut in: flat under the road and shoulders, then an embankment
 * or cutting whose width grows with the height difference to the natural terrain.
 */
export function blendedHeight(natural: number, hit: RoadHit | null) {
  if (!hit) return natural;
  const road = hit.y - roadBed;
  const fall = clamp(Math.abs(natural - road) * 1.7, 10, maxBlend);
  const w = smoothstep(corridor, corridor + fall, hit.distance);
  return road + (natural - road) * w;
}

/** Dry-season Oaxaca: straw grass, olive scrub, rusty soil, grey rock on steep ground. */
const straw = [0.86, 0.77, 0.56],
  olive = [0.55, 0.56, 0.36],
  green = [0.47, 0.54, 0.31],
  rust = [0.72, 0.52, 0.38],
  rock = [0.6, 0.56, 0.5],
  dust = [0.78, 0.71, 0.58];
const tint = simplex2(99);
/** Writes an RGB ground color into `out` without allocating (called for every vertex). */
export function groundColor(
  x: number,
  z: number,
  height: number,
  floor: number,
  slope: number,
  roadDistance: number,
  out: number[],
) {
  const n = 0.5 + 0.5 * tint(x / 90, z / 90),
    m = 0.5 + 0.5 * tint(x / 23 + 40, z / 23 - 17);
  const above = smoothstep(4, 160, height - floor);
  const a = clamp(n * 0.9 + above * 0.4, 0, 1),
    b = clamp((m - 0.55) * 1.6, 0, 0.6) * (1 - above * 0.5),
    c = clamp((n - 0.62) * 2.2, 0, 0.55),
    d = smoothstep(0.45, 0.9, slope),
    e = 1 - smoothstep(corridor, corridor + 6, roadDistance);
  for (let k = 0; k < 3; k++) {
    let v = straw[k] + (olive[k] - straw[k]) * a;
    v += (green[k] - v) * b;
    v += (rust[k] - v) * c;
    v += (rock[k] - v) * d;
    v += (dust[k] - v) * e;
    out[k] = v;
  }
}
