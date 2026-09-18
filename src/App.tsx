import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowUpRight,
  Bike,
  Bluetooth,
  ChevronRight,
  Mountain,
  Pencil,
  Play,
  ShieldCheck,
  Timer,
  X,
} from 'lucide-react';
import RoadScene from './scene/RoadScene';
import Profile from './ui/Profile';
import { presets, totalSeconds, type Workout } from './workouts/model';
import { RideEngine, type Session, type Source } from './ride/engine';
import {
  defaults,
  loadSettings,
  loadWorkouts,
  loadSessions,
  saveSettings,
  saveWorkout,
  removeSession,
  type Settings as RiderSettings,
} from './storage/store';
import { trainer } from './trainer/bluetooth';
import Ride from './ui/Ride';
import WorkoutEditor from './ui/WorkoutEditor';
import Diagnostics from './ui/Diagnostics';
import History, { Summary } from './ui/History';
import Settings from './ui/Settings';
import RoadSetup, { routeWorkout } from './ui/RoadSetup';
import type { Route } from './ride/terrain';
import {
  workoutControlIssue,
  workoutPowerRange,
  workoutPowerCeiling,
} from './ride/workout-control';
type Page = 'Ride' | 'Workouts' | 'Ride history' | 'Trainer' | 'Settings';
export default function App() {
  const [page, setPage] = useState<Page>('Ride'),
    [selected, setSelected] = useState(presets[0]),
    [filter, setFilter] = useState('All workouts');
  const [settings, setSettings] = useState<RiderSettings>(defaults),
    [custom, setCustom] = useState<Workout[]>([]),
    [sessions, setSessions] = useState<Session[]>([]);
  const [source, setSource] = useState<Source | 'controlled'>('demo'),
    [engine, setEngine] = useState<RideEngine | null>(null),
    [summary, setSummary] = useState<Session | null>(null);
  const [editor, setEditor] = useState(false),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [ergReady, setErgReady] = useState(false);
  const ergIssue = workoutControlIssue(selected, settings.ftp);
  const ergRange = settings.ftp === null ? null : workoutPowerRange(selected, settings.ftp);
  useEffect(() => setErgReady(false), [selected, settings.ftp, source]);
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
        setError(
          'Local storage is unavailable. You can preview workouts, but ride saving may fail.',
        ),
      )
      .finally(() => setLoaded(true));
  }, []);
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
      /* The app works without optional WebMCP. */
    }
    return () => lifecycle.abort();
  }, [custom]);
  const start = () => {
    setError('');
    try {
      if (source !== 'demo') {
        if (
          device.status !== 'connected' ||
          device.telemetry.powerAt === undefined ||
          performance.now() - device.telemetry.powerAt > 3000
        )
          throw new Error(
            'Pair your KICKR in Trainer, then pedal to receive fresh power before starting.',
          );
        if (settings.ftp === null)
          throw new Error('Enter your known FTP in Settings before starting a live workout.');
      }
      if (source === 'controlled') {
        if (!ergReady || ergIssue) throw new Error(ergIssue ?? 'Confirm ERG readiness first.');
        const device = trainer.getPilotDevice('erg');
        if (
          device.range.increment !== 1 ||
          device.range.min > 40 ||
          device.range.max < workoutPowerCeiling(selected, settings.ftp!)
        )
          throw new Error('The trainer power range cannot represent this workout.');
      }
      setEngine(
        new RideEngine(
          selected,
          source === 'controlled' ? 'bluetooth' : source,
          settings.ftp ?? 200,
          settings.mass,
          {
            trainerControl: source === 'controlled' ? 'erg' : undefined,
            bikeMass: settings.bikeMass ?? 9,
            wheel: settings.wheel,
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const startRoad = (route: Route, source: Source, controlled = false) => {
    setError('');
    try {
      if (
        source === 'bluetooth' &&
        (device.status !== 'connected' ||
          device.telemetry.powerAt === undefined ||
          performance.now() - device.telemetry.powerAt > 3000)
      )
        throw new Error('Pair your KICKR in Trainer and confirm fresh power before starting.');
      if (controlled) trainer.getPilotDevice('sim');
      setEngine(
        new RideEngine(routeWorkout(route), source, settings.ftp, settings.mass, {
          route,
          trainerControl: controlled ? 'sim' : undefined,
          bikeMass: settings.bikeMass ?? 9,
          wheel: settings.wheel,
        }),
      );
    } catch (error) {
      setError((error as Error).message);
    }
  };
  if (engine)
    return (
      <Ride
        engine={engine}
        quality={settings.quality}
        onFinish={(s) => {
          setEngine(null);
          setSummary(s);
          void loadSessions()
            .then(setSessions)
            .catch(() =>
              setError('History could not be refreshed. Export this summary to keep a copy.'),
            );
        }}
      />
    );
  const navigate = (next: Page) => {
    setPage(next);
    setSummary(null);
    setError('');
    window.scrollTo(0, 0);
  };
  const workouts = [...presets, ...custom],
    filtered = workouts.filter(
      (w) =>
        filter === 'All workouts' || (filter === 'My workouts' ? w.custom : w.category === filter),
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <button onClick={() => navigate('Ride')} className="brand" aria-label="BikeSIM home">
          <Bike size={29} />
          <span>
            BIKE<span>SIM</span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          {(['Ride', 'Workouts', 'Ride history', 'Trainer', 'Settings'] as Page[]).map((p) => (
            <button
              key={p}
              className={page === p && !summary ? 'active' : ''}
              onClick={() => navigate(p)}
            >
              {p}
            </button>
          ))}
        </nav>
        <button className="top-status" onClick={() => navigate('Trainer')}>
          <ShieldCheck size={15} /> Local & private <span className="separator" />
          <Bluetooth size={16} />{' '}
          {device.status === 'connected' ? 'Trainer connected' : 'Trainer offline'}
        </button>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button aria-label="Dismiss message" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
      {summary ? (
        <Summary session={summary} onBack={() => navigate(summary.route ? 'Ride' : 'Workouts')} />
      ) : page === 'Ride' ? (
        <RoadSetup settings={settings} loaded={loaded} onStart={startRoad} />
      ) : page === 'Trainer' ? (
        <Diagnostics settings={settings} />
      ) : page === 'Settings' ? (
        <Settings
          settings={settings}
          onSave={async (s) => {
            await saveSettings(s);
            setSettings(s);
          }}
          onImport={refresh}
        />
      ) : page === 'Ride history' ? (
        <History
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
      ) : (
        <main className="library">
          <div className="page-heading">
            <div>
              <div className="eyebrow">ERG · STRUCTURED POWER WORKOUTS</div>
              <h1>Find your next ride.</h1>
              <p>A focused workout. An open road. Just you.</p>
            </div>
            <span className="pill">
              <span className="status-dot" /> Demo ready
            </span>
          </div>
          <section className="feature">
            <div className="feature-copy">
              <span className="eyebrow">A ROAD OF YOUR OWN</span>
              <h2>
                Somewhere
                <br />
                worth pedaling.
              </h2>
              <p>
                Structured training in the foothills.
                <br />
                Start with a workout below.
              </p>
              <div className="feature-foot">
                <Mountain size={19} />
                <div>
                  Oaxaca foothills<span>Procedural landscape · Offline</span>
                </div>
                <ArrowUpRight size={20} />
              </div>
            </div>
            <div className="feature-scene">
              <RoadScene speed={8} quality={settings.quality} />
              <span className="scene-tag">OAXACA, MÉXICO · INSPIRED LANDSCAPE</span>
            </div>
          </section>
          <div className="section-title">
            <h2>Choose your effort</h2>
            <span>{workouts.length} workouts · made for your own rhythm</span>
          </div>
          <div className="filters" aria-label="Workout categories">
            {[
              'All workouts',
              'Endurance',
              'Sweet spot',
              'Hills',
              'Recovery',
              'Tempo',
              'Threshold',
              'Cadence',
              'My workouts',
            ].map((f) => (
              <button
                key={f}
                aria-pressed={f === filter}
                className={f === filter ? 'selected' : ''}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="workout-layout">
            <div className="workout-grid">
              {filtered.map((w) => (
                <button
                  key={w.id}
                  aria-pressed={selected.id === w.id}
                  className={`workout-card ${selected.id === w.id ? 'chosen' : ''}`}
                  onClick={() => setSelected(w)}
                >
                  <div className="card-top">
                    <span className="eyebrow">{w.custom ? 'My workout' : w.category}</span>
                    <ArrowUpRight size={17} />
                  </div>
                  <h3>{w.name}</h3>
                  <Profile workout={w} />
                  <div className="card-meta">
                    <span>
                      <Timer size={15} /> {Math.round(totalSeconds(w) / 60)} min
                    </span>
                    <span>Power workout</span>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="empty-state">
                  <h3>A workout of your own.</h3>
                  <p>Choose any preset and use Customize to save your version.</p>
                </div>
              )}
            </div>
            <aside className="workout-detail">
              <span className="eyebrow">TODAY'S RIDE</span>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
              <Profile workout={selected} large />
              <div className="detail-stats">
                <span>
                  <strong>{Math.round(totalSeconds(selected) / 60)}</strong> minutes
                </span>
                <span>
                  <strong>{selected.blocks.length}</strong> intervals
                </span>
                <span>
                  <strong>
                    {Math.round(
                      Math.max(...selected.blocks.map((b) => Math.max(b.from, b.to))) * 100,
                    )}
                    %
                  </strong>{' '}
                  peak FTP
                </span>
              </div>
              <label className="source-label">
                Ride source
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as Source | 'controlled')}
                >
                  <option value="demo">Demo · simulated rider</option>
                  <option value="bluetooth">KICKR · live power, read-only</option>
                  {import.meta.env.VITE_TRAINER_CONTROL === 'pilot' && (
                    <option value="controlled">KICKR · automatic ERG workout</option>
                  )}
                </select>
              </label>
              <div className="start-note">
                {source === 'demo'
                  ? `Demo FTP: ${settings.ftp ?? 200} W${settings.ftp === null ? ' (example)' : ''}. No trainer commands.`
                  : source === 'controlled'
                    ? `ERG follows your workout targets${ergRange ? `: ${ergRange.min}–${ergRange.max} W at ${settings.ftp} W FTP` : ''}. Starts at 50 W, then changes by up to 10 W per second. The HUD shows requested and acknowledged watts separately.`
                    : 'Live metrics and target guidance. Automatic resistance is not enabled.'}
              </div>
              {source === 'controlled' && (
                <>
                  {ergIssue && <p role="alert">{ergIssue}</p>}
                  <p className="fine-print">
                    Use the small front chainring and a middle rear cog. Keep cadence steady and
                    above 50 rpm; low or missing cadence pauses ERG. Visual hills do not add slope
                    resistance in this mode.
                  </p>
                  <label className="source-label">
                    <input
                      type="checkbox"
                      checked={ergReady}
                      onChange={(e) => setErgReady(e.target.checked)}
                    />
                    I’m ready for automatic ERG: my FTP and trainer profile are correct, the current
                    load is comfortable, other trainer apps are closed, and I understand the
                    selected watt targets and 80–110% intensity adjustment.
                  </label>
                </>
              )}
              <button
                className="primary"
                onClick={start}
                disabled={!loaded || (source === 'controlled' && (!ergReady || !!ergIssue))}
              >
                <Play size={18} />{' '}
                {source === 'demo'
                  ? 'Start demo ride'
                  : source === 'controlled'
                    ? 'Start ERG workout'
                    : 'Start live-power ride'}{' '}
                <ChevronRight size={17} />
              </button>
              <button className="secondary full customize-button" onClick={() => setEditor(true)}>
                <Pencil size={15} /> Customize workout
              </button>
              <p className="fine-print">10-second countdown · Stop at any time</p>
            </aside>
          </div>
        </main>
      )}
      <footer>
        BIKESIM <span>Built for the ride. Kept on your computer.</span>
        <span>Oaxaca, MX</span>
      </footer>
      {editor && (
        <WorkoutEditor
          workout={selected}
          onClose={() => setEditor(false)}
          onSave={async (w) => {
            await saveWorkout(w);
            setCustom(await loadWorkouts());
            setSelected(w);
            setFilter('My workouts');
            setEditor(false);
          }}
        />
      )}
    </div>
  );
}
