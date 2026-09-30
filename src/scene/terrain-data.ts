import type { Route, TerrainGrid } from '../ride/terrain';
import { gridGround, type Ground } from './ground';

async function fetchGrid(grid: TerrainGrid) {
  const res = await fetch(`/routes/${grid.file}`);
  if (!res.ok) throw new Error(`Terrain for this road is missing (${res.status}).`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength !== grid.columns * grid.rows * 2)
    throw new Error('Terrain for this road is damaged.');
  return { grid, heights: new Uint16Array(buffer) };
}

const cache = new Map<string, Promise<Ground>>();
/** The real terrain around a road, loaded once per road; null for procedural roads. */
export function loadGround(route: Route): Promise<Ground> | null {
  if (!route.terrain) return null;
  let pending = cache.get(route.id);
  if (!pending) {
    const { near, far } = route.terrain;
    pending = Promise.all([fetchGrid(near), fetchGrid(far)]).then(([n, f]) =>
      gridGround(n, f, route.startElevation ?? 1550),
    );
    cache.set(route.id, pending);
    pending.catch(() => cache.delete(route.id));
  }
  return pending;
}
