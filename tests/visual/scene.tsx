import { createRoot } from 'react-dom/client';
import RoadScene from '../../src/scene/RoadScene';
import { routes } from '../../src/ride/terrain';
import { routeCourse } from '../../src/ride/course';
const params = new URLSearchParams(location.search);
const route = routes.find((r) => r.id === params.get('route')) ?? routes[0];
const distance = Number(params.get('distance') ?? 0);
// A stationary ride position: the scene reads motion from a ref, not from props.
const motion = { current: { distance, speed: 0, at: 0 } };
createRoot(document.getElementById('root')!).render(
  <RoadScene
    course={routeCourse(route)}
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
