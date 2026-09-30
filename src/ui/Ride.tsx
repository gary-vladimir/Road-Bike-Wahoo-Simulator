import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Maximize,
  Minus,
  Pause,
  Play,
  Plus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import RoadScene, { type RideMotion } from '../scene/RoadScene';
import { clock, position, totalSeconds } from '../workouts/model';
import { RideEngine, type Session } from '../ride/engine';
import { trainer } from '../trainer/bluetooth';
import { saveSession } from '../storage/store';
import { routeLength, routePosition, type Route } from '../ride/terrain';
import { coastStatus } from '../ride/physics';
import { RideTrainer } from '../ride/ride-trainer';
import { TrainerSession, roadCoefficients } from '../trainer/session';
import { ElevationProfile, WorkoutProfile } from './charts';
import { BrandMark } from './kit';

/** Steepest grade within the next stretch of road, for the look-ahead hint. */
function ahead(route: Route, meters: number, span = 300) {
  let min = Infinity,
    max = -Infinity;
  for (let d = 0; d <= span; d += 25) {
    const g = routePosition(route, meters + d).grade;
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  return { min, max };
}
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

export default function Ride({
  engine,
  quality,
  difficulty = 100,
  onFinish,
}: {
  engine: RideEngine;
  quality: string;
  /** Percent of road slope the trainer applies (SIM). */
  difficulty?: number;
  onFinish: (session: Session) => void;
}) {
  const [state, setState] = useState({ ...engine.state });
  const [storageError, setStorageError] = useState('');
  const [fullscreenError, setFullscreenError] = useState('');
  const [sceneReady, setSceneReady] = useState(false);
  const [focus, setFocus] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const container = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());
  const motion = useRef<RideMotion>({
    distance: engine.state.distance * 1000,
    speed: engine.state.speed,
    at: performance.now(),
  });
  const session = engine.session;
  const route = session.route;
  const controlled = !!session.trainerControl;
  const erg = session.trainerControl === 'erg';
  const refresh = () => setState({ ...engine.state });
  const [link] = useState(() =>
    controlled
      ? new RideTrainer(
          engine,
          (changed) =>
            TrainerSession.open(
              trainer.controlSource(erg ? 'erg' : 'sim'),
              erg
                ? { mode: 'erg', powerCeiling: RideTrainer.ceiling(engine) }
                : { mode: 'sim', road: roadCoefficients(engine.setup) },
              changed,
            ),
          () => setState({ ...engine.state }),
          difficulty / 100,
        )
      : null,
  );
  const persist = () => {
    const snapshot = structuredClone(engine.session);
    queue.current = queue.current
      .then(() => saveSession(snapshot))
      .then(() => setStorageError(''))
      .catch(() =>
        setStorageError('Could not save this ride. Keep this tab open and export it after.'),
      );
    return queue.current;
  };
  const pause = (reason?: string) => {
    engine.pause(reason);
    // The trainer eases to a light load right away rather than on the next tick.
    link?.update();
    refresh();
    void persist();
  };
  const nudge = (step: number) => {
    if (route) {
      if (session.source === 'demo') engine.setDemoEffort(engine.demoEffort + step * 10);
    } else engine.setBias(engine.state.bias + step * 0.05);
    refresh();
  };
  useEffect(() => {
    if (!sceneReady) return;
    if (link && engine.state.phase === 'countdown') void link.start();
    void persist();
    let lastSave = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (!link || link.ready) engine.tick(now, trainer.snapshot.telemetry);
      motion.current = {
        distance: engine.state.distance * 1000,
        speed: engine.state.speed,
        at: now,
      };
      link?.update();
      setState({ ...engine.state });
      if (now - lastSave > 5000) {
        lastSave = now;
        void persist();
      }
      if (engine.state.phase === 'finished') {
        clearInterval(timer);
        void (link?.finish() ?? Promise.resolve())
          .then(persist)
          .then(() => onFinish(structuredClone(engine.session)));
      }
    }, 100);
    const hidden = () => {
      if (document.hidden) pause('Paused while BikeSIM was hidden.');
    };
    const keys = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        if (engine.state.phase !== 'paused')
          pause('Paused from the keyboard. Resume when you are ready.');
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        nudge(e.code === 'ArrowUp' ? 1 : -1);
      }
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (engine.state.phase !== 'finished') {
        pause('Page closed or refreshed.');
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', keys);
    window.addEventListener('beforeunload', leaving);
    return () => {
      clearInterval(timer);
      void link?.finish();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [engine, sceneReady]);

  const current = position(session.workout, state.elapsed),
    next = session.workout.blocks[current.index + 1];
  const terrain = route ? routePosition(route, state.distance * 1000) : null;
  const look = route ? ahead(route, state.distance * 1000) : null;
  const trainerState = link?.snapshot;
  const coast = coastStatus(state.speed, state.grade, engine.setup);
  const ftp = session.ftp ?? 0;
  const target = state.target || Math.round(current.target * ftp * state.bias);
  const ratio = target && state.power !== undefined ? state.power / target : undefined;
  const running = state.phase === 'running';
  const resume = () => {
    engine.resume();
    link?.resume();
    refresh();
  };
  const finish = () => {
    engine.finish();
    refresh();
  };
  const chip = (() => {
    if (session.source === 'demo')
      return { dot: '', text: 'Demo rider', detail: route ? `${engine.demoEffort} W effort` : '' };
    if (!link) return { dot: 'live', text: 'KICKR CORE 2', detail: 'live power · load unchanged' };
    if (!link.ready)
      return { dot: link.ended ? 'error' : 'busy', text: 'KICKR CORE 2', detail: link.message };
    if (erg)
      return trainerState?.recovery
        ? { dot: 'busy', text: 'Easing to 50 W', detail: 'spin up to continue' }
        : {
            dot: 'live',
            text: 'KICKR CORE 2',
            detail: `holding ${trainerState?.appliedWatts ?? '—'} W`,
          };
    return {
      dot: 'live',
      text: 'KICKR CORE 2',
      detail: `trainer slope ${trainerState?.appliedGrade?.toFixed(1) ?? '—'}%${difficulty < 100 ? ` · ${difficulty}%` : ''}`,
    };
  })();
  return (
    <div
      className="ride"
      data-quality={quality}
      data-mode={route ? 'sim' : 'erg'}
      data-focus={focus}
      ref={container}
    >
      <div className="ride-scene">
        <RoadScene
          course={engine.course}
          motion={motion}
          moving={running}
          quality={quality}
          onReady={onSceneReady}
        />
      </div>
      <div className="ride-scrim-top" />
      <div className="ride-scrim-bottom" />
      <div className="ride-top">
        {route ? (
          <div className="ride-id">
            <BrandMark size={24} />
            <div>
              <div className="ride-name">{route.name}</div>
              <div className="ride-sub">
                {session.source === 'demo'
                  ? 'Demo ride · simulated rider'
                  : controlled
                    ? 'Road ride · the trainer follows the slope'
                    : 'Road ride · live power, trainer load unchanged'}
              </div>
            </div>
          </div>
        ) : (
          <div className="ride-cue">
            <span className="eyebrow">
              Interval {current.index + 1} of {session.workout.blocks.length} ·{' '}
              {erg ? 'ERG' : session.source === 'demo' ? 'demo' : 'guided'}
            </span>
            <div className="ride-name">{current.block.name}</div>
            <p>{current.block.cue}</p>
          </div>
        )}
        <div className="ride-actions">
          <div className="hud-chip" aria-label="Trainer status">
            <span className={`dot ${chip.dot}`} />
            <span>{chip.text}</span>
            {chip.detail && <span className="muted">{chip.detail}</span>}
          </div>
          <button
            className="hud-btn"
            aria-label={focus ? 'Show ride details' : 'Focus on the road'}
            aria-pressed={focus}
            title={focus ? 'Show ride details' : 'Focus on the road'}
            onClick={() => setFocus(!focus)}
          >
            {focus ? <Eye size={19} /> : <EyeOff size={19} />}
          </button>
          <button
            className="hud-btn"
            aria-label="Toggle fullscreen"
            onClick={() => {
              const request = document.fullscreenElement
                ? document.exitFullscreen()
                : container.current?.requestFullscreen();
              void request?.catch(() => setFullscreenError('Fullscreen is unavailable here.'));
            }}
          >
            <Maximize size={19} />
          </button>
          <button className="btn btn-light" onClick={() => pause()}>
            <Pause size={17} fill="currentColor" /> Pause
          </button>
        </div>
      </div>
      {route && running && state.power === 0 && (
        <div className="hud-chip coast-chip" aria-label="Motion status">
          <strong>{coast.trend === 'Stopped' ? 'Stopped' : 'Coasting'}</strong>
          <span className="muted">
            {coast.trend === 'Stopped' ? 'pedal to get going' : coast.trend.toLowerCase()}
          </span>
        </div>
      )}
      {(storageError || fullscreenError) && (
        <div className="alert ride-toast" role="alert">
          {storageError || fullscreenError}
        </div>
      )}
      <div className="dock">
        {route && terrain && look ? (
          <>
            <div className="dock-metrics">
              <div className="metric">
                <span className="metric-label">Power</span>
                <span className="metric-value xl">
                  {state.power ?? '—'}
                  <span className="metric-unit">W</span>
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Cadence</span>
                <span className="metric-value">
                  {state.cadence ?? '—'}
                  <span className="metric-unit">rpm</span>
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Speed</span>
                <span className="metric-value">
                  {state.speed.toFixed(1)}
                  <span className="metric-unit">km/h</span>
                </span>
              </div>
              <span className="dock-spacer" />
              <div className="metric accent end">
                <span className="metric-label">
                  {state.grade < -0.05 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}
                  Grade
                </span>
                <span className="metric-value xl">
                  {signed(state.grade)}
                  <span className="metric-unit">%</span>
                </span>
                <span className="metric-note">
                  {look.max - state.grade > 0.5
                    ? `Up to ${signed(look.max)}% in the next 300 m`
                    : state.grade - look.min > 0.5
                      ? `Easing to ${signed(look.min)}% ahead`
                      : 'Steady ahead'}
                </span>
              </div>
            </div>
            <div className="dock-track">
              <div className="dock-figure">
                <strong>{state.distance.toFixed(2)}</strong>
                <span>of {(routeLength(route) / 1000).toFixed(1)} km</span>
              </div>
              <ElevationProfile
                route={route}
                meters={state.distance * 1000}
                className="elevation track-graph"
              />
              <div className="dock-figure">
                <strong>{clock(state.elapsed)}</strong>
                <span>riding</span>
              </div>
              <div className="dock-figure">
                <strong>{Math.round(terrain.ascent)} m</strong>
                <span>climbed</span>
              </div>
              {session.source === 'demo' && (
                <label className="demo-effort">
                  <span className="sr-only">Demo effort</span>
                  <input
                    aria-label="Demo effort watts"
                    type="range"
                    min={0}
                    max={400}
                    step={10}
                    value={engine.demoEffort}
                    onChange={(e) => {
                      engine.setDemoEffort(Number(e.target.value));
                      refresh();
                    }}
                  />
                  <button
                    className="btn btn-s"
                    onClick={() => {
                      engine.setDemoEffort(0);
                      refresh();
                    }}
                  >
                    Coast
                  </button>
                </label>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="dock-metrics">
              <div className="metric accent">
                <span className="metric-label">Target</span>
                <span className="metric-value xl">
                  {target}
                  <span className="metric-unit">W</span>
                </span>
              </div>
              <div className="metric" style={{ width: 260 }}>
                <span className="metric-label">Power</span>
                <span className="metric-value xl">
                  {state.power ?? '—'}
                  <span className="metric-unit">W</span>
                </span>
                <div
                  className="power-band"
                  role="img"
                  aria-label={
                    ratio === undefined
                      ? 'No power reading'
                      : `Power is ${Math.round((ratio - 1) * 100)}% from target`
                  }
                >
                  <span className="band" style={{ left: '41.7%', width: '16.7%' }} />
                  {ratio !== undefined && (
                    <span
                      className="needle"
                      style={{ left: `${Math.min(1, Math.max(0, (ratio - 0.7) / 0.6)) * 100}%` }}
                    />
                  )}
                </div>
              </div>
              <div className="metric">
                <span className="metric-label">Cadence</span>
                <span className="metric-value">
                  {state.cadence ?? '—'}
                  <span className="metric-unit">rpm · aim {current.block.cadence}</span>
                </span>
              </div>
              <span className="dock-spacer" />
              <div className="metric end">
                <span className="metric-label">Interval left</span>
                <span className="metric-value xl">{clock(current.remaining)}</span>
              </div>
            </div>
            <div className="dock-track">
              <div className="track-graph">
                <WorkoutProfile workout={session.workout} elapsed={state.elapsed} />
              </div>
              <div className="dock-figure" style={{ width: 170 }}>
                <span>Up next</span>
                <strong style={{ fontSize: 20 }}>
                  {next ? `${next.name} · ${clock(next.seconds)}` : 'Finish'}
                </strong>
                <span>
                  {next ? `${Math.round(next.from * ftp * state.bias)} W` : 'Nearly there'}
                </span>
              </div>
              <div className="intensity" role="group" aria-label="Workout intensity">
                <button
                  aria-label="Decrease intensity"
                  disabled={state.bias <= 0.8}
                  onClick={() => nudge(-1)}
                >
                  <Minus size={16} />
                </button>
                <span>{Math.round(state.bias * 100)}%</span>
                <button
                  aria-label="Increase intensity"
                  disabled={state.bias >= 1.1}
                  onClick={() => nudge(1)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="dock-figure">
                <strong>{clock(state.elapsed)}</strong>
                <span>of {clock(totalSeconds(session.workout))}</span>
              </div>
            </div>
          </>
        )}
      </div>
      {state.phase === 'countdown' && (
        <div className="ride-overlay">
          <span className="eyebrow">
            {!sceneReady
              ? 'Preparing the road'
              : state.elapsed > 0
                ? 'Back to your rhythm'
                : 'Your road is ready'}
          </span>
          <strong className="countdown-number">
            {sceneReady && (!link || link.ready) ? Math.ceil(state.countdown) : '…'}
          </strong>
          <p>
            {link
              ? link.ready
                ? erg
                  ? 'The trainer is holding 50 W. Keep pedaling; your targets start after the countdown.'
                  : 'The trainer is on a flat road. Pick a comfortable gear; the terrain follows.'
                : link.message
              : session.source === 'demo'
                ? 'The demo rider is clipping in.'
                : 'Start pedaling. The trainer load stays as it is.'}
          </p>
          <button className="btn" onClick={() => pause()}>
            Cancel countdown
          </button>
        </div>
      )}
      {state.phase === 'paused' && (
        <div className="ride-overlay">
          <div className="pause-card">
            <span className="eyebrow">Take your time</span>
            <h1>Ride paused.</h1>
            <p>{state.reason}</p>
            {link && (
              <p>
                {link.ended
                  ? `${link.message} Resume takes control again${erg ? ' once you pedal above 50 rpm' : ''}.`
                  : erg
                    ? 'The trainer is holding a light 50 W.'
                    : 'The trainer is holding a flat road.'}
              </p>
            )}
            <div className="pause-stats">
              <div className="dock-figure">
                <strong>{clock(state.elapsed)}</strong>
                <span>riding</span>
              </div>
              <div className="dock-figure">
                <strong>{state.distance.toFixed(2)} km</strong>
                <span>distance</span>
              </div>
            </div>
            <button className="btn btn-primary btn-l" onClick={resume}>
              <Play size={18} fill="currentColor" /> Resume ride <ChevronRight size={18} />
            </button>
            <button className="btn" onClick={finish}>
              Finish & save ride
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
