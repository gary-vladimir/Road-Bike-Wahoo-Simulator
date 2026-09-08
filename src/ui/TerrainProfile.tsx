import { routeLength, routePosition, type Route } from '../ride/terrain';
export default function TerrainProfile({ route, meters = 0 }: { route: Route; meters?: number }) {
  const samples = Array.from({ length: 101 }, (_, i) =>
    routePosition(route, (routeLength(route) * i) / 100),
  );
  const low = Math.min(0, ...samples.map((s) => s.elevation)),
    high = Math.max(10, ...samples.map((s) => s.elevation));
  const y = (elevation: number) => 84 - ((elevation - low) / (high - low)) * 70;
  const points = samples.map((s, i) => `${i * 6},${y(s.elevation)}`).join(' ');
  const here = routePosition(route, meters);
  return (
    <svg
      className="terrain-profile"
      viewBox="0 0 600 100"
      role="img"
      aria-label={`${route.name} elevation profile, ${(routeLength(route) / 1000).toFixed(1)} kilometers`}
    >
      <polygon points={`0,94 ${points} 600,94`} fill="#91a76533" />
      <polyline points={points} stroke="#d9ff69" strokeWidth="2.5" fill="none" />
      <circle cx={here.progress * 600} cy={y(here.elevation)} r="4" fill="#fff" />
    </svg>
  );
}
