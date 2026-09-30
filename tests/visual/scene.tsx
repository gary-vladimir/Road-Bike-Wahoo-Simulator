import { createRoot } from 'react-dom/client';
import RoadScene from '../../src/scene/RoadScene';
import { allRoads } from '../../src/ride/catalog';
import { routeCourse } from '../../src/ride/course';
import { loadGround } from '../../src/scene/terrain-data';
const params = new URLSearchParams(location.search);
const route = allRoads.find((r) => r.id === params.get('route')) ?? allRoads[0];
const distance = Number(params.get('distance') ?? 0);
// km/h. Above zero the harness rides forward like a real ride: 10 Hz ticks the scene
// extrapolates between.
const speed = Math.max(0, Number(params.get('speed') ?? 0));
// The scene reads motion from a ref, not from props.
const motion = { current: { distance, speed, at: performance.now() } };
if (speed > 0)
  setInterval(() => {
    const now = performance.now();
    motion.current = {
      distance: motion.current.distance + (speed / 3.6) * ((now - motion.current.at) / 1000),
      speed,
      at: now,
    };
  }, 100);

/** Frame intervals for measuring pacing on a real GPU: `window.__frameStats()`. */
const intervals: number[] = [];
let last = 0;
const frame = (t: number) => {
  if (last) intervals.push(t - last);
  if (intervals.length > 3600) intervals.shift();
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
Object.assign(window, {
  __frameStats: () => {
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (q: number) => Math.round(sorted[Math.floor(q * (sorted.length - 1))] * 10) / 10;
    const total = intervals.reduce((sum, v) => sum + v, 0);
    return {
      frames: intervals.length,
      fps: Math.round((intervals.length / total) * 1000 * 10) / 10,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      max: Math.round(sorted.at(-1)! * 10) / 10,
      over25ms: intervals.filter((v) => v > 25).length,
      meters: Math.round(motion.current.distance),
    };
  },
  __resetFrameStats: () => (intervals.length = 0),
});
// `&stats` shows the numbers on screen, refreshed every second.
if (params.has('stats')) {
  const panel = Object.assign(document.createElement('pre'), {
    style:
      'position:fixed;top:8px;left:8px;margin:0;padding:8px 10px;z-index:1;color:#fff;' +
      'background:rgba(0,0,0,.6);font:12px/1.4 ui-monospace,monospace;border-radius:6px',
  });
  document.body.append(panel);
  setInterval(() => {
    const s = (window as unknown as { __frameStats: () => Record<string, number> }).__frameStats();
    panel.textContent = `${s.fps} fps · p95 ${s.p95} ms · max ${s.max} ms\n${s.over25ms} of ${s.frames} frames over 25 ms · ${s.meters} m`;
  }, 1000);
}

const ground = (await loadGround(route)) ?? undefined;
createRoot(document.getElementById('root')!).render(
  <RoadScene
    course={routeCourse(route)}
    ground={ground}
    motion={motion}
    // Render continuously: headless capture needs presented frames.
    moving
    quality={params.get('quality') ?? 'high'}
    onReady={() => {
      setTimeout(() => {
        document.body.dataset.ready = 'true';
      }, 400);
    }}
  />,
);
