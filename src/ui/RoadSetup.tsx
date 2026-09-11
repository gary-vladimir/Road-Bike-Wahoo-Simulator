import { useState } from 'react';
import { Mountain, Play } from 'lucide-react';
import { routes, routeLength, routePosition, type Route } from '../ride/terrain';
import type { Source } from '../ride/engine';
import type { Settings } from '../storage/store';
import type { Workout } from '../workouts/model';
import RoadScene from '../scene/RoadScene';
import TerrainProfile from './TerrainProfile';
import { stockWheel, wheelLabel } from '../ride/bike';
export function routeWorkout(route: Route): Workout {
  const block = {
    name: 'Your own pace',
    seconds: 10800,
    from: 0.5,
    to: 0.5,
    cadence: 80,
    grade: 0,
    cue: 'Choose your own effort and cadence.',
  };
  return {
    id: `route-${route.id}`,
    name: route.name,
    category: 'Endurance',
    description: route.description,
    blocks: [block, { ...block }],
  };
}
export default function RoadSetup({
  settings,
  loaded,
  onStart,
}: {
  settings: Settings;
  loaded: boolean;
  onStart: (route: Route, source: Source) => void;
}) {
  const [route, setRoute] = useState(routes[0]),
    [source, setSource] = useState<Source>('demo');
  const length = routeLength(route),
    finish = routePosition(route, length);
  return (
    <main className="library road-library">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SIM · YOUR ROAD, YOUR GEARS</div>
          <h1>Ride at your own pace.</h1>
          <p>Choose a road. Find your rhythm. Shift as the terrain changes.</p>
        </div>
        <span className="pill">Terrain preview</span>
      </div>
      <section className="feature">
        <div className="feature-copy">
          <span className="eyebrow">OAXACA, MÉXICO · INSPIRED</span>
          <h2>
            The road
            <br />
            is yours.
          </h2>
          <p>
            Distance sets the terrain.
            <br />
            You set the effort.
          </p>
          <div className="feature-foot">
            <Mountain size={20} />
            <div>
              Free riding<span>{routes.length} procedural routes · Offline</span>
            </div>
          </div>
        </div>
        <div className="feature-scene">
          <RoadScene speed={8} quality={settings.quality} />
          <span className="scene-tag">PROCEDURAL SCENERY · NOT A REAL OAXACA ROUTE</span>
        </div>
      </section>
      <div className="section-title">
        <h2>Choose your road</h2>
        <span>SIM terrain · no prescribed watts or cadence</span>
      </div>
      <div className="workout-layout">
        <div className="route-grid">
          {routes.map((r) => (
            <button
              key={r.id}
              className={`workout-card ${r.id === route.id ? 'chosen' : ''}`}
              aria-pressed={r.id === route.id}
              onClick={() => setRoute(r)}
            >
              <div className="eyebrow">
                {(routeLength(r) / 1000).toFixed(1)} KM · PROCEDURAL ROAD
              </div>
              <h3>{r.name}</h3>
              <p>{r.description}</p>
              <TerrainProfile route={r} />
              <div className="card-meta">
                <span>{Math.round(routePosition(r, routeLength(r)).ascent)} m climbing</span>
                <span>Up to {Math.max(...r.points.map((p) => p.grade))}%</span>
              </div>
            </button>
          ))}
        </div>
        <aside className="workout-detail">
          <span className="eyebrow">TODAY'S ROAD</span>
          <h2>{route.name}</h2>
          <p>{route.description}</p>
          <TerrainProfile route={route} />
          <div className="detail-stats">
            <span>
              <strong>{(length / 1000).toFixed(1)}</strong> km
            </span>
            <span>
              <strong>{Math.round(finish.ascent)}</strong> m ascent
            </span>
            <span>
              <strong>SIM</strong> terrain
            </span>
          </div>
          <label className="source-label">
            Ride source
            <select value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="demo">Demo · adjustable effort</option>
              <option value="bluetooth">KICKR · live power, read-only</option>
            </select>
          </label>
          <p className="start-note">
            {source === 'demo'
              ? 'Explore terrain physics with a simulated rider. Adjust watts or coast during the ride.'
              : 'Your power moves the scene. FTP is not required. Existing trainer resistance remains unchanged.'}
          </p>
          <button className="primary" disabled={!loaded} onClick={() => onStart(route, source)}>
            <Play size={17} />
            {source === 'demo' ? 'Start road demo' : 'Start live road preview'}
          </button>
          <p className="fine-print">
            Automatic terrain resistance is awaiting hardware validation. This preview sends no
            trainer commands.
          </p>
          <p className="fine-print">
            Speed estimate: {settings.mass} kg rider + {settings.bikeMass ?? 9} kg bike. Edit weight
            and {wheelLabel(settings.wheel ?? stockWheel)} tires in Settings. No gear-position
            sensor is assumed.
          </p>
        </aside>
      </div>
    </main>
  );
}
