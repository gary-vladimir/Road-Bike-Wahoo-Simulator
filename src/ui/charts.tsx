import { memo, useMemo } from 'react';
import { clock, totalSeconds, zoneColor, type Workout } from '../workouts/model';
import type { Session } from '../ride/engine';
import { routeLength, routePosition, type Route } from '../ride/terrain';

/** Workout blocks as bars: width is duration, height and color are intensity. */
export const WorkoutProfile = memo(function WorkoutProfile({
  workout,
  elapsed,
  large = false,
}: {
  workout: Workout;
  elapsed?: number;
  large?: boolean;
}) {
  const total = totalSeconds(workout);
  const peak = Math.max(1.2, ...workout.blocks.map((b) => Math.max(b.from, b.to)));
  let start = 0;
  return (
    <div
      className={`profile ${large ? 'large' : ''} ${elapsed !== undefined ? 'past-dim' : ''}`}
      role="img"
      aria-label={`${workout.name}: ${workout.blocks.length} intervals, ${Math.round(total / 60)} minutes`}
    >
      {workout.blocks.map((b, i) => {
        const top = Math.max(b.from, b.to);
        const clip =
          b.from !== b.to
            ? `polygon(0 ${(1 - b.from / top) * 100}%, 100% ${(1 - b.to / top) * 100}%, 100% 100%, 0 100%)`
            : undefined;
        const past = elapsed !== undefined && start + b.seconds <= elapsed;
        start += b.seconds;
        return (
          <span
            key={i}
            className={past ? 'past' : undefined}
            style={{
              flexGrow: b.seconds,
              height: `${(top / peak) * 100}%`,
              background: zoneColor((b.from + b.to) / 2),
              clipPath: clip,
            }}
            title={`${b.name} · ${Math.round(b.seconds / 60)} min · ${Math.round(b.to * 100)}% FTP`}
          />
        );
      })}
      {elapsed !== undefined && (
        <span
          className="profile-cursor"
          style={{ left: `${Math.min(100, (elapsed / total) * 100)}%` }}
        />
      )}
    </div>
  );
});

const samplesFor = (route: Route, count = 120) => {
  const length = routeLength(route);
  return Array.from({ length: count + 1 }, (_, i) => routePosition(route, (length * i) / count));
};

/** Elevation silhouette; the ridden part is highlighted when `meters` is given. */
export const ElevationProfile = memo(function ElevationProfile({
  route,
  meters,
  height = 70,
  className = 'elevation',
}: {
  route: Route;
  meters?: number;
  height?: number;
  className?: string;
}) {
  const samples = useMemo(() => samplesFor(route), [route]);
  const low = Math.min(...samples.map((s) => s.elevation)),
    high = Math.max(low + 10, ...samples.map((s) => s.elevation));
  const y = (e: number) => height - 4 - ((e - low) / (high - low)) * (height - 10);
  const x = (i: number) => (i / (samples.length - 1)) * 1000;
  const points = samples.map((s, i) => [x(i), y(s.elevation)] as const);
  const progress = meters === undefined ? 1 : Math.min(1, Math.max(0, meters / routeLength(route)));
  const cut = progress * 1000;
  const here = meters === undefined ? undefined : routePosition(route, meters);
  const hereY = here ? y(here.elevation) : 0;
  const past = points.filter(([px]) => px < cut);
  const future = points.filter(([px]) => px > cut);
  const line = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const pastLine = here ? [...past, [cut, hereY] as const] : points;
  const futureLine = here ? [[cut, hereY] as const, ...future] : [];
  return (
    <svg
      className={className}
      viewBox={`0 0 1000 ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${route.name} elevation profile, ${(routeLength(route) / 1000).toFixed(1)} km${
        here ? `, ${Math.round(progress * 100)}% ridden` : ''
      }`}
    >
      <polygon
        points={`0,${height} ${line(pastLine)} ${here ? cut : 1000},${height}`}
        fill="var(--accent)"
        fillOpacity={here ? 0.32 : 0.22}
      />
      {here && (
        <polygon
          points={`${cut},${height} ${line(futureLine)} 1000,${height}`}
          fill="#f5f1ea"
          fillOpacity="0.1"
        />
      )}
      <polyline
        points={line(pastLine)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
      {here && (
        <>
          <polyline
            points={line(futureLine)}
            fill="none"
            stroke="#f5f1ea"
            strokeOpacity="0.55"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={cut}
            x2={cut}
            y1="0"
            y2={height}
            stroke="#f5f1ea"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
});

/** Power across the ride: over distance with an elevation silhouette for roads, over time with
 * the dashed target for workouts. Power is smoothed over ~10 s for readability. */
export const RideChart = memo(function RideChart({ session }: { session: Session }) {
  const samples = session.samples;
  const road = !!session.route;
  const data = useMemo(() => {
    if (samples.length < 2) return null;
    const step = Math.max(1, Math.ceil(samples.length / 600));
    const smooth = samples.map((_, i) => {
      const from = Math.max(0, i - 9);
      const slice = samples.slice(from, i + 1);
      return slice.reduce((n, p) => n + p.power, 0) / slice.length;
    });
    const span = road ? Math.max(0.001, session.distance) : Math.max(1, session.elapsed);
    const picked = samples
      .map((p, i) => ({ p, power: smooth[i] }))
      .filter((_, i) => i % step === 0 || i === samples.length - 1);
    const top = Math.max(100, ...picked.map((d) => Math.max(d.power, d.p.target))) * 1.12;
    const x = (d: { p: (typeof samples)[number] }) =>
      ((road ? d.p.distance : d.p.elapsed) / span) * 1000;
    const y = (w: number) => 300 - (w / top) * 290;
    const power = picked.map((d) => `${x(d).toFixed(1)},${y(d.power).toFixed(1)}`).join(' ');
    const target = road
      ? ''
      : picked.map((d) => `${x(d).toFixed(1)},${y(d.p.target).toFixed(1)}`).join(' ');
    let terrain = '';
    if (road) {
      const heights = picked.map(
        (d) => routePosition(session.route!, d.p.distance * 1000).elevation,
      );
      const lo = Math.min(...heights),
        hi = Math.max(lo + 10, ...heights);
      terrain = picked
        .map(
          (d, i) =>
            `${x(d).toFixed(1)},${(300 - ((heights[i] - lo) / (hi - lo)) * 120 - 4).toFixed(1)}`,
        )
        .join(' ');
    }
    return { power, target, terrain, top, span };
  }, [samples, road, session.distance, session.elapsed, session.route]);
  if (!data) return <p className="muted">Not enough samples to draw this ride.</p>;
  return (
    <>
      <svg
        className="chart"
        viewBox="0 0 1000 300"
        preserveAspectRatio="none"
        role="img"
        aria-label={road ? 'Power and elevation over distance' : 'Power and target over time'}
      >
        {data.terrain && <polygon points={`0,300 ${data.terrain} 1000,300`} fill="#2d3540" />}
        {data.target && (
          <polyline
            points={data.target}
            fill="none"
            stroke="#8b93a0"
            strokeWidth="2"
            strokeDasharray="6 6"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={data.power}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-axis">
        <span>0</span>
        <span>{road ? `${(data.span / 2).toFixed(1)} km` : clock(data.span / 2)}</span>
        <span>{road ? `${data.span.toFixed(1)} km` : clock(data.span)}</span>
      </div>
    </>
  );
});

/** A real road seen from above, north up, with the rider's position. */
export const RouteMap = memo(function RouteMap({
  route,
  meters,
  className = 'route-map',
}: {
  route: Route;
  meters?: number;
  className?: string;
}) {
  const shape = useMemo(() => {
    const path = route.path;
    if (!path?.length) return null;
    const every = Math.max(1, Math.floor(path.length / 400));
    const pts = path.filter((_, i) => i % every === 0 || i === path.length - 1);
    const xs = pts.map((p) => p[0]),
      zs = pts.map((p) => p[1]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      z0 = Math.min(...zs),
      z1 = Math.max(...zs);
    const span = Math.max(x1 - x0, z1 - z0, 1);
    const k = 180 / span;
    const ox = 100 - ((x0 + x1) / 2) * k,
      oz = 100 - ((z0 + z1) / 2) * k;
    const project = (x: number, z: number) => [ox + x * k, oz + z * k] as const;
    return {
      line: pts
        .map(([x, z]) =>
          project(x, z)
            .map((v) => v.toFixed(1))
            .join(','),
        )
        .join(' '),
      project,
    };
  }, [route]);
  if (!shape || !route.path) return null;
  const step = route.pathStep ?? 10;
  const [sx, sz] = shape.project(...route.path[0]);
  const [ex, ez] = shape.project(...route.path.at(-1)!);
  let here: readonly [number, number] | undefined;
  if (meters !== undefined) {
    const f = Math.min(route.path.length - 1, Math.max(0, meters / step));
    const i = Math.min(route.path.length - 2, Math.floor(f)),
      t = f - i;
    const [ax, az] = route.path[i],
      [bx, bz] = route.path[i + 1];
    here = shape.project(ax + (bx - ax) * t, az + (bz - az) * t);
  }
  return (
    <svg className={className} viewBox="0 0 200 200" role="img" aria-label={`Map of ${route.name}`}>
      <polyline
        points={shape.line}
        fill="none"
        stroke="rgb(245 241 234 / 0.35)"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polyline
        points={shape.line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={sx} cy={sz} r="4" fill="#f5f1ea" />
      <rect x={ex - 4} y={ez - 4} width="8" height="8" fill="#f5f1ea" />
      {here && (
        <circle
          cx={here[0]}
          cy={here[1]}
          r="6.5"
          fill="var(--accent)"
          stroke="#0b0e12"
          strokeWidth="2.5"
        />
      )}
    </svg>
  );
});
