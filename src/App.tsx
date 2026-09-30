import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { presets, totalSeconds, type Workout } from './workouts/model';
import type { RideEngine, Session } from './ride/engine';
import {
  defaults,
  loadSettings,
  loadWorkouts,
  loadSessions,
  removeSession,
  removeWorkout,
  saveSettings,
  saveWorkout,
  type Settings,
} from './storage/store';
import { trainer, type DeviceSnapshot } from './trainer/bluetooth';
import { setControlGate } from './trainer/session';
import { createRide, freshPower, type RideRequest, type RideSource } from './app/launch';
import RidePage, { type Page } from './pages/RidePage';
import WorkoutsPage from './pages/WorkoutsPage';
import HistoryPage from './pages/HistoryPage';
import SummaryPage from './pages/SummaryPage';
import SettingsPage from './pages/SettingsPage';
import TrainerPage from './pages/TrainerPage';
import Ride from './ui/Ride';
import FtpTest from './ui/FtpTest';
import WorkoutEditor from './ui/WorkoutEditor';
import { BrandMark } from './ui/kit';
import { routes } from './ride/terrain';

const pages: { id: Page; label: string }[] = [
  { id: 'ride', label: 'Ride' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

function TrainerChip({ device, onClick }: { device: DeviceSnapshot; onClick: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const live = freshPower(device);
  return (
    <button className="trainer-chip" onClick={onClick} aria-label="Trainer connection">
      <span
        className={`dot ${device.status === 'connected' ? 'live' : device.status === 'connecting' ? 'busy' : ''}`}
      />
      {device.status === 'connected' ? device.name : 'Pair your KICKR'}
      {device.status === 'connected' && (
        <span className="muted">{live ? `${device.telemetry.power ?? 0} W` : 'idle'}</span>
      )}
    </button>
  );
}

/** Read-only workout list for browsers that expose WebMCP; never touches the trainer. */
function useWebMcp(custom: Workout[]) {
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: object, options: { signal: AbortSignal }) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'list_bikesim_workouts',
            description:
              'Read available BikeSIM workouts without connecting to or controlling a trainer.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: () =>
              [...presets, ...custom].map((w) => ({
                id: w.id,
                name: w.name,
                category: w.category,
                seconds: totalSeconds(w),
              })),
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {
      /* Optional. */
    }
    return () => lifecycle.abort();
  }, [custom]);
}

export default function App() {
  const [page, setPage] = useState<Page>('ride');
  const [settings, setSettings] = useState<Settings>(defaults);
  const [custom, setCustom] = useState<Workout[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Workout>(presets.find((w) => w.id === 'sweet-spot')!);
  const [engine, setEngine] = useState<RideEngine | null>(null);
  const [lastRequest, setLastRequest] = useState<RideRequest | null>(null);
  const [summary, setSummary] = useState<Session | null>(null);
  const [editing, setEditing] = useState<Workout | null>(null);
  const [ftpTest, setFtpTest] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  // Trainer sessions check the rider's current Settings switch each time one opens.
  const controlEnabled = useRef(false);
  controlEnabled.current = settings.trainerControl === true;
  useEffect(() => setControlGate(() => controlEnabled.current), []);
  useWebMcp(custom);
  const refresh = async () => {
    const [profile, workouts, rides] = await Promise.all([
      loadSettings(),
      loadWorkouts(),
      loadSessions(),
    ]);
    setSettings(profile);
    setCustom(workouts);
    setSessions(rides);
  };
  useEffect(() => {
    void trainer.restore();
    void refresh()
      .catch(() =>
        setError('Local storage is unavailable. You can look around, but rides may not save.'),
      )
      .finally(() => setLoaded(true));
  }, []);
  const navigate = (next: Page) => {
    setPage(next);
    setSummary(null);
    setError('');
    window.scrollTo(0, 0);
  };
  const start = (request: RideRequest) => {
    setError('');
    try {
      setEngine(createRide(request, settings, device));
      setLastRequest(request);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rideAgain = (session: Session) => {
    if (lastRequest && summary?.id === session.id) return start(lastRequest);
    const route = session.route && routes.find((r) => r.id === session.route!.id);
    const source: RideSource =
      session.source === 'demo' ? 'demo' : session.trainerControl ? 'control' : 'live';
    if (route) return start({ kind: 'road', route, source });
    return start({ kind: 'workout', workout: session.workout, source });
  };

  if (ftpTest)
    return (
      <FtpTest
        canControl={settings.trainerControl === true}
        onClose={() => {
          void refresh()
            .catch(() => setError('Could not refresh your settings.'))
            .finally(() => setFtpTest(false));
        }}
      />
    );
  if (engine)
    return (
      <Ride
        engine={engine}
        quality={settings.quality}
        difficulty={settings.difficulty ?? 100}
        onFinish={(s) => {
          setEngine(null);
          setSummary(s);
          window.scrollTo(0, 0);
          void loadSessions()
            .then(setSessions)
            .catch(() => setError('History could not be refreshed. Export this ride to keep it.'));
        }}
      />
    );
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('ride')} aria-label="BikeSIM home">
          <BrandMark />
          <span className="brand-name">BIKESIM</span>
        </button>
        <nav className="nav" aria-label="Main">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-current={page === p.id && !summary ? 'page' : undefined}
              onClick={() => navigate(p.id)}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <span className="topbar-spacer" />
        <TrainerChip device={device} onClick={() => navigate('trainer')} />
      </header>
      {error && (
        <div className="alert banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
      {summary ? (
        <SummaryPage
          session={summary}
          onBack={() => setSummary(null)}
          onRideAgain={() => rideAgain(summary)}
        />
      ) : page === 'ride' ? (
        <RidePage
          settings={settings}
          sessions={sessions}
          device={device}
          loaded={loaded}
          onStart={start}
          onNavigate={navigate}
          onOpenWorkout={(w) => {
            setSelected(w);
            navigate('workouts');
          }}
        />
      ) : page === 'workouts' ? (
        <WorkoutsPage
          settings={settings}
          device={device}
          custom={custom}
          selected={selected}
          loaded={loaded}
          onSelect={setSelected}
          onStart={start}
          onCustomize={setEditing}
          onDelete={async (w) => {
            try {
              await removeWorkout(w.id);
              setCustom(await loadWorkouts());
              setSelected(presets[0]);
            } catch {
              setError('Could not delete this workout.');
            }
          }}
          onFtpTest={() => setFtpTest(true)}
          onNavigate={navigate}
        />
      ) : page === 'history' ? (
        <HistoryPage
          sessions={sessions}
          onOpen={setSummary}
          onDelete={async (id) => {
            try {
              await removeSession(id);
              setSessions(await loadSessions());
            } catch {
              setError('Could not delete this ride. Please retry.');
            }
          }}
        />
      ) : page === 'trainer' ? (
        <TrainerPage settings={settings} onOpenSettings={() => navigate('settings')} />
      ) : (
        <SettingsPage
          key={loaded ? 'loaded' : 'loading'}
          settings={settings}
          onFtpTest={() => setFtpTest(true)}
          onSave={async (s) => {
            await saveSettings(s);
            setSettings(s);
          }}
          onImport={refresh}
        />
      )}
      <footer className="app-footer">
        <span>BikeSIM · built for the ride, kept on your computer</span>
        <span>Oaxaca, MX</span>
      </footer>
      {editing && (
        <WorkoutEditor
          workout={editing}
          onClose={() => setEditing(null)}
          onSave={async (w) => {
            await saveWorkout(w);
            setCustom(await loadWorkouts());
            setSelected(w);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
