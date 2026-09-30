import monteAlban from './routes/monte-alban.json';
import sanFelipe from './routes/san-felipe.json';
import tuleMitla from './routes/tule-mitla.json';
import teotitlan from './routes/teotitlan.json';
import { routes as practiceRoads, validateRoute, type Route } from './terrain';

/**
 * Real Oaxaca roads, built once by scripts/build-routes.mjs from OpenStreetMap geometry and
 * SRTM-derived elevation, and shipped with the app so rides work offline.
 */
export const realRoads: Route[] = [monteAlban, sanFelipe, tuleMitla, teotitlan].map((data) => {
  const { summary: _summary, ...route } = data as unknown as Route & { summary?: unknown };
  validateRoute(route);
  return route;
});

export { practiceRoads };
export const allRoads = [...realRoads, ...practiceRoads];
export const findRoad = (id: string) => allRoads.find((r) => r.id === id);
