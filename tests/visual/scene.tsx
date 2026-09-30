import { createRoot } from 'react-dom/client';
import RoadScene from '../../src/scene/RoadScene';
import { routes, routePosition } from '../../src/ride/terrain';
const params = new URLSearchParams(location.search);
const route = routes.find((r) => r.id === params.get('route')) ?? routes[0];
const distance = Number(params.get('distance') ?? 0);
// A stationary ride position: the scene reads motion from a ref, not from props.
const motion = { current: { distance, speed: 0, at: 0 } };
createRoot(document.getElementById('root')!).render(
  <RoadScene
    route={route}
    motion={motion}
    grade={routePosition(route, distance).grade}
    quality={params.get('quality') ?? 'high'}
    onReady={() => {
      document.body.dataset.ready = 'true';
    }}
  />,
);
