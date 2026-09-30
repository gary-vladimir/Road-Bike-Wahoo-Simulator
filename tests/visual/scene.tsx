import { createRoot } from 'react-dom/client';
import RoadScene from '../../src/scene/RoadScene';
import { allRoads } from '../../src/ride/catalog';
import { routeCourse } from '../../src/ride/course';
import { loadGround } from '../../src/scene/terrain-data';
const params = new URLSearchParams(location.search);
const route = allRoads.find((r) => r.id === params.get('route')) ?? allRoads[0];
const distance = Number(params.get('distance') ?? 0);
// A stationary ride position: the scene reads motion from a ref, not from props.
const motion = { current: { distance, speed: 0, at: 0 } };
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
