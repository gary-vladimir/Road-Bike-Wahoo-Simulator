import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { routes, routeLength, routePosition, type Route } from '../ride/terrain';
import type { Session } from '../ride/engine';
import type { DeviceSnapshot } from '../trainer/bluetooth';
import type { Settings } from '../storage/store';
import { clock, todaysWorkout, totalSeconds, workoutLoad, type Workout } from '../workouts/model';
import { ridingPositions } from '../ride/physics';
import { exampleFtp, launchIssue, type RideRequest, type RideSource } from '../app/launch';
import { ElevationProfile, WorkoutProfile } from '../ui/charts';
import { Segmented, Stat } from '../ui/kit';

export type Page = 'ride' | 'workouts' | 'history' | 'settings' | 'trainer';

const routeKey = 'bikesim.route';
const remembered = () => {
  try {
    return localStorage.getItem(routeKey);
  } catch {
    return null;
  }
};

export function sourceOptions(settings: Settings, kind: 'road' | 'workout') {
  return [
    { value: 'demo' as const, label: 'Demo' },
    { value: 'live' as const, label: 'Live power' },
    ...(settings.trainerControl
      ? [
          {
            value: 'control' as const,
            label: kind === 'road' ? 'Trainer sets the slope' : 'Trainer holds the watts',
          },
        ]
      : []),
  ];
}

export function preferredSource(settings: Settings, device: DeviceSnapshot): RideSource {
  if (device.status !== 'connected') return 'demo';
  return settings.trainerControl ? 'control' : 'live';
}

export function SourceNote({
  request,
  settings,
  device,
  onNavigate,
}: {
  request: RideRequest;
  settings: Settings;
  device: DeviceSnapshot;
  onNavigate: (page: Page) => void;
}) {
  const issue = launchIssue(request, settings, device);
  const road = request.kind === 'road';
  const note =
    request.source === 'demo'
      ? road
        ? 'A simulated rider. Set the effort or coast during the ride; the trainer is not used.'
        : `A simulated rider follows the targets${settings.ftp === null ? ` using an example ${exampleFtp} W FTP` : ''}. The trainer is not used.`
      : request.source === 'live'
        ? 'Your KICKR’s power moves you. BikeSIM reads it but does not change the load.'
        : road
          ? `The KICKR follows the road while you shift${
              (settings.difficulty ?? 100) < 100 ? `, at ${settings.difficulty}% difficulty` : ''
            }. Pausing eases to a flat road.`
          : 'The KICKR holds each target. If your cadence drops for a few seconds it eases to 50 W until you spin back up.';
  return (
    <div className="source-picker">
      <p className="source-note">{note}</p>
      {issue && (
        <div className="notice" role="status">
          <span>{issue}</span>
          {device.status !== 'connected' && request.source !== 'demo' && (
            <button className="link" onClick={() => onNavigate('trainer')}>
              Open Trainer
            </button>
          )}
          {issue.includes('Settings') && (
            <button className="link" onClick={() => onNavigate('settings')}>
              Open Settings
            </button>
          )}
        </div>
      )}
      {!settings.trainerControl && request.source !== 'demo' && !issue && (
        <p className="fine">
          Want the trainer to {road ? 'follow the road' : 'hold your targets'}? Turn on trainer
          control in{' '}
          <button className="link" onClick={() => onNavigate('settings')}>
            Settings
          </button>
          .
        </p>
      )}
    </div>
  );
}

function routeStats(route: Route) {
  const length = routeLength(route);
  return {
    km: length / 1000,
    climb: routePosition(route, length).ascent,
    steepest: Math.max(...route.points.map((p) => p.grade)),
  };
}

export default function RidePage({
  settings,
  sessions,
  device,
  loaded,
  onStart,
  onNavigate,
  onOpenWorkout,
}: {
  settings: Settings;
  sessions: Session[];
  device: DeviceSnapshot;
  loaded: boolean;
  onStart: (request: RideRequest) => void;
  onNavigate: (page: Page) => void;
  onOpenWorkout: (workout: Workout) => void;
}) {
  const [route, setRoute] = useState<Route>(
    () => routes.find((r) => r.id === remembered()) ?? routes[0],
  );
  const [source, setSource] = useState<RideSource>(() => preferredSource(settings, device));
  const options = sourceOptions(settings, 'road');
  const chosen = options.some((o) => o.value === source) ? source : 'demo';
  const request: RideRequest = { kind: 'road', route, source: chosen };
  const issue = launchIssue(request, settings, device);
  const stats = routeStats(route);
  const today = todaysWorkout();
  const load = workoutLoad(today);
  const week = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const real = sessions.filter(
      (s) => s.source === 'bluetooth' && Date.parse(s.startedAt) >= since,
    );
    return {
      rides: real.length,
      seconds: real.reduce((n, s) => n + s.elapsed, 0),
      km: real.reduce((n, s) => n + s.distance, 0),
    };
  }, [sessions]);
  const pick = (r: Route) => {
    setRoute(r);
    try {
      localStorage.setItem(routeKey, r.id);
    } catch {
      /* Remembering the road is a convenience only. */
    }
  };
  return (
    <main className="page">
      <div className="split">
        <section className="stack">
          <div className="hero">
            <img className="hero-img" src={`/scenes/${route.id}.jpg`} alt="" />
            <div className="hero-shade" />
            <div className="hero-body">
              <span className="eyebrow">Ride today</span>
              <h1 className="hero-title">{route.name}</h1>
              <p>{route.description}</p>
              <div className="stats">
                <Stat value={stats.km.toFixed(1)} unit="km" label="distance" />
                <Stat value={Math.round(stats.climb)} unit="m" label="climbing" />
                <Stat value={`+${stats.steepest}`} unit="%" label="steepest" />
              </div>
              <Segmented
                label="Ride source"
                options={options}
                value={chosen}
                onChange={setSource}
              />
              <div className="hero-actions">
                <button
                  className="btn btn-primary btn-l"
                  disabled={!loaded || !!issue}
                  onClick={() => onStart(request)}
                >
                  <Play size={18} fill="currentColor" /> Start ride
                </button>
              </div>
              <SourceNote
                request={request}
                settings={settings}
                device={device}
                onNavigate={onNavigate}
              />
            </div>
            <span className="hero-tag">PROCEDURAL ROAD · OAXACA-INSPIRED</span>
          </div>
          <div className="section-head">
            <h2>Roads</h2>
            <span>Distance sets the terrain · you set the effort</span>
          </div>
          <div className="route-grid">
            {routes.map((r) => {
              const s = routeStats(r);
              return (
                <button
                  key={r.id}
                  className="route-card"
                  aria-pressed={r.id === route.id}
                  onClick={() => pick(r)}
                >
                  <img src={`/scenes/${r.id}.jpg`} alt="" loading="lazy" />
                  <span className="route-card-body">
                    <strong>{r.name}</strong>
                    <span>
                      {s.km.toFixed(1)} km · {Math.round(s.climb)} m · up to {s.steepest}%
                    </span>
                    <ElevationProfile route={r} height={36} className="elevation mini" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <aside className="stack">
          <section className="card">
            <div className="card-head">
              <h2>Workout for today</h2>
              <button className="link" onClick={() => onNavigate('workouts')}>
                All workouts
              </button>
            </div>
            <div>
              <strong style={{ fontSize: 20 }}>{today.name}</strong>
              <p className="muted">
                {Math.round(totalSeconds(today) / 60)} min · {today.category} · TSS {load.stress}
              </p>
            </div>
            <WorkoutProfile workout={today} />
            <button className="btn" onClick={() => onOpenWorkout(today)}>
              Ride this workout
            </button>
          </section>
          <section className="card">
            <h2>This week</h2>
            <div className="stats">
              <Stat value={week.rides} label={week.rides === 1 ? 'ride' : 'rides'} />
              <Stat value={clock(week.seconds)} label="riding" />
              <Stat value={week.km.toFixed(1)} unit="km" label="virtual" />
            </div>
            <p className="fine">Live rides from the last 7 days. Demo rides aren’t counted.</p>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Your setup</h2>
              <button className="link" onClick={() => onNavigate('settings')}>
                Edit
              </button>
            </div>
            <div className="kv">
              <span>FTP</span>
              {settings.ftp === null ? (
                <button className="link" onClick={() => onNavigate('workouts')}>
                  Take the ramp test
                </button>
              ) : (
                <span>{settings.ftp} W</span>
              )}
            </div>
            <div className="kv">
              <span>Rider · bike</span>
              <span>
                {settings.mass} kg · {settings.bikeMass ?? 9} kg
              </span>
            </div>
            <div className="kv">
              <span>Position</span>
              <span>{ridingPositions[settings.position ?? 'hoods'].label}</span>
            </div>
            <div className="kv">
              <span>Trainer control</span>
              <span>
                {settings.trainerControl ? `On · ${settings.difficulty ?? 100}% difficulty` : 'Off'}
              </span>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
