import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Maximize,
  Minus,
  Pause,
  Play,
  Plus,
  Square,
  Eye,
  EyeOff,
} from 'lucide-react';
import RoadScene, { type RideMotion } from '../scene/RoadScene';
import Profile from './Profile';
import { clock, position, totalSeconds } from '../workouts/model';
import { RideEngine, type Session } from '../ride/engine';
import { trainer } from '../trainer/bluetooth';
import { saveSession } from '../storage/store';
import { routeLength, routePosition } from '../ride/terrain';
import { coastStatus } from '../ride/physics';
import TerrainProfile from './TerrainProfile';
import { stockWheel, virtualWheelRpm } from '../ride/bike';
import { RideTrainer } from '../ride/ride-trainer';
import { TrainerSession, roadCoefficients } from '../trainer/session';

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
  const [savedAt, setSavedAt] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');
  const [sceneReady, setSceneReady] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const container = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());
  const motion = useRef<RideMotion>({
    distance: engine.state.distance * 1000,
    speed: engine.state.speed,
    at: performance.now(),
  });
  const controlled = !!engine.session.trainerControl;
  const erg = engine.session.trainerControl === 'erg';
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
      .then(() => {
        setSavedAt(true);
        setStorageError('');
      })
      .catch(() => {
        setStorageError(
          'Could not save this ride. Keep this tab open and export the summary before leaving.',
        );
      });
    return queue.current;
  };
  const pause = (reason?: string) => {
    engine.pause(reason);
    // The trainer eases to a light load right away rather than waiting for the next tick.
    link?.update();
    refresh();
    void persist();
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
      if (performance.now() - lastSave > 5000) {
        lastSave = performance.now();
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
        pause('Paused from the keyboard. Resume when you are ready.');
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
  const current = position(engine.session.workout, state.elapsed),
    next = engine.session.workout.blocks[current.index + 1];
  const route = engine.session.route;
  const terrain = route ? routePosition(route, state.distance * 1000) : null;
  const trainerState = link?.snapshot;
  const coast = coastStatus(state.speed, state.grade, engine.setup);
  const resume = () => {
    engine.resume();
    link?.resume();
    refresh();
  };
  const finish = () => {
    engine.finish();
    refresh();
  };
  return (
    <div
      className="ride-screen"
      data-quality={quality}
      data-mode={engine.session.route ? 'sim' : 'erg'}
      data-immersive={immersive}
      ref={container}
    >
      <div className="ride-world">
        <RoadScene
          motion={motion}
          moving={state.phase === 'running'}
          grade={state.grade}
          route={engine.session.route}
          quality={quality}
          onReady={onSceneReady}
        />
      </div>
      <div className="ride-top">
        <button className="glass-button" onClick={() => pause()}>
          <ArrowLeft size={18} /> Menu
        </button>
        <div className="ride-title">
          <span className="eyebrow">
            {engine.session.source === 'demo'
              ? 'DEMO RIDE · SIMULATED DATA'
              : controlled
                ? erg
                  ? 'LIVE POWER · AUTOMATIC ERG WORKOUT'
                  : 'LIVE POWER · AUTOMATIC SIM TERRAIN'
                : 'LIVE POWER · RESISTANCE NOT CONTROLLED'}
          </span>
          <h2>{engine.session.workout.name}</h2>
        </div>
        <div className="view-controls">
          <button
            className="glass-button icon-only"
            aria-label={immersive ? 'Show ride details' : 'Focus on the road'}
            aria-pressed={immersive}
            onClick={() => setImmersive(!immersive)}
            title={immersive ? 'Show ride details' : 'Focus on the road'}
          >
            {immersive ? <Eye size={19} /> : <EyeOff size={19} />}
          </button>
          <button
            className="glass-button icon-only"
            aria-label="Toggle fullscreen"
            onClick={() => {
              const request = document.fullscreenElement
                ? document.exitFullscreen()
                : container.current?.requestFullscreen();
              void request?.catch(() =>
                setFullscreenError('Fullscreen is unavailable in this browser.'),
              );
            }}
          >
            <Maximize size={19} />
          </button>
        </div>
      </div>
      <div className="ride-metrics">
        <div className="power-metric">
          <span>POWER</span>
          <strong>
            {state.power ?? '—'}
            <small>W</small>
          </strong>
          <div>
            {route ? (
              'Your effort · no watt target'
            ) : (
              <>
                Target{' '}
                <b>{state.target || Math.round(current.target * (engine.session.ftp ?? 0))} W</b>
              </>
            )}
          </div>
        </div>
        <div>
          <span>CADENCE</span>
          <strong>
            {state.cadence ?? '—'}
            <small>rpm</small>
          </strong>
          <div>
            {route ? 'Your cadence · shift freely' : `Aim for ${current.block.cadence} rpm`}
          </div>
        </div>
        <div>
          <span>VIRTUAL SPEED</span>
          <strong>
            {state.speed.toFixed(1)}
            <small>km/h</small>
          </strong>
          <div>{state.distance.toFixed(2)} km ridden</div>
        </div>
      </div>
      <div className="ride-route">
        <MountainBadge />
        <strong>{route?.name ?? 'Oaxaca foothills'}</strong>
        <span>
          {route
            ? controlled
              ? 'SIM terrain · physical gears'
              : 'SIM terrain preview · resistance unchanged'
            : erg
              ? 'ERG workout · automatic watts'
              : 'ERG workout preview'}
        </span>
        <div>
          <b>{state.grade.toFixed(1)}%</b> visual grade
        </div>
        {controlled && (
          <div aria-label="Trainer control status">
            {erg ? (
              <>
                <b>{trainerState?.appliedWatts ?? '—'} W</b> trainer target
              </>
            ) : (
              <>
                <b>{trainerState?.appliedGrade?.toFixed(1) ?? '—'}%</b> trainer slope
                {difficulty < 100 ? ` · ${difficulty}% difficulty` : ''}
              </>
            )}
            <p>{link?.message}</p>
          </div>
        )}
        {route && (
          <div className="coasting-state" aria-label="Motion status">
            <strong>
              {state.phase !== 'running'
                ? 'Ride paused'
                : state.power === 0
                  ? coast.trend === 'Stopped'
                    ? 'Stopped · pedal to move'
                    : 'Coasting · 0 W'
                  : 'Pedaling'}
            </strong>
            {state.phase === 'running' && state.power === 0 && coast.trend !== 'Stopped' && (
              <em className="coasting-trend">{coast.trend}</em>
            )}
            <span>
              {state.phase === 'running' && state.power === 0
                ? coast.explanation
                : 'Road speed follows power, gravity, and momentum.'}
            </span>
            <small>
              {Math.round(virtualWheelRpm(state.speed, engine.session.wheel ?? stockWheel))} virtual
              wheel rpm
            </small>
          </div>
        )}
      </div>
      {(storageError || fullscreenError) && (
        <div className="ride-warning" role="alert">
          {storageError || fullscreenError}
        </div>
      )}
      <div className="ride-bottom">
        <div className="interval-line">
          {route && terrain ? (
            <>
              <div>
                <span className="eyebrow">SIM · FREE RIDE</span>
                <h2>{route.name}</h2>
                <p>Choose your effort. Terrain follows your distance.</p>
              </div>
              <div className="interval-clock">
                <strong>{(terrain.remaining / 1000).toFixed(2)} km</strong>
                <span>road remaining</span>
              </div>
              <div className="next-block">
                <span>CLIMBING</span>
                <strong>{Math.round(terrain.ascent)} m</strong>
                <small>{Math.round(terrain.progress * 100)}% of the road</small>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="eyebrow">
                  INTERVAL {current.index + 1} / {engine.session.workout.blocks.length}
                </span>
                <h2>{current.block.name}</h2>
                <p>{current.block.cue}</p>
              </div>
              <div className="interval-clock">
                <strong>{clock(current.remaining)}</strong>
                <span>interval remaining</span>
              </div>
              <div className="next-block">
                <span>UP NEXT</span>
                <strong>{next?.name ?? 'Ride complete'}</strong>
                <small>
                  {next
                    ? `${clock(next.seconds)} · ${Math.round(next.to * (engine.session.ftp ?? 0) * state.bias)} W`
                    : 'Time to cool off.'}
                </small>
              </div>
            </>
          )}
        </div>
        {route ? (
          <TerrainProfile route={route} meters={state.distance * 1000} wide />
        ) : (
          <Profile workout={engine.session.workout} elapsed={state.elapsed} />
        )}
        <div className="ride-controls">
          <span className="ride-time">
            {clock(state.elapsed)}{' '}
            <span>
              {route
                ? `/ ${(routeLength(route) / 1000).toFixed(1)} km road`
                : `/ ${clock(totalSeconds(engine.session.workout))}`}
            </span>
          </span>
          {route ? (
            engine.session.source === 'demo' ? (
              <label className="demo-effort">
                Demo effort
                <input
                  aria-label="Demo effort watts"
                  type="range"
                  min={0}
                  max={400}
                  step={10}
                  value={engine.demoEffort}
                  onChange={(e) => {
                    engine.setDemoEffort(Number(e.target.value));
                    setState({ ...engine.state });
                  }}
                />
                <span>{engine.demoEffort} W</span>
                <button
                  className="secondary"
                  onClick={() => {
                    engine.setDemoEffort(0);
                    setState({ ...engine.state });
                  }}
                >
                  Coast
                </button>
              </label>
            ) : (
              <span>Your physical gears · your pace</span>
            )
          ) : (
            <div className="intensity-control">
              <button
                aria-label="Decrease intensity"
                onClick={() => {
                  engine.setBias(state.bias - 0.05);
                  setState({ ...engine.state });
                }}
                disabled={state.bias <= 0.8}
              >
                <Minus size={15} />
              </button>
              <span>{Math.round(state.bias * 100)}% intensity</span>
              <button
                aria-label="Increase intensity"
                onClick={() => {
                  engine.setBias(state.bias + 0.05);
                  setState({ ...engine.state });
                }}
                disabled={state.bias >= 1.1}
              >
                <Plus size={15} />
              </button>
            </div>
          )}
          <span className="saved-indicator">
            {savedAt && !storageError ? 'Saved on this computer' : 'Saving…'}
          </span>
          <button className="secondary" onClick={() => pause()}>
            <Pause size={16} /> Pause
          </button>
          <button
            className="stop-button"
            onClick={() => pause('Ride paused. Finish to save it, or resume when you are ready.')}
          >
            <Square size={14} fill="currentColor" /> Stop
          </button>
        </div>
      </div>
      {state.phase === 'countdown' && (
        <div className="ride-overlay countdown-overlay">
          <span className="eyebrow">
            {sceneReady
              ? state.elapsed > 0
                ? 'BACK TO YOUR RHYTHM'
                : 'YOUR ROAD IS READY'
              : 'PREPARING THE ROAD'}
          </span>
          <strong className="countdown-number">
            {sceneReady && (!link || link.ready) ? Math.ceil(state.countdown) : '…'}
          </strong>
          <p>
            {link
              ? link.ready
                ? erg
                  ? 'ERG is holding 50 W. Keep pedaling; workout targets follow after the countdown.'
                  : 'The trainer is on a flat road. Pick a comfortable gear; terrain follows the countdown.'
                : link.message
              : engine.session.source === 'demo'
                ? 'Demo rider starting. No trainer commands.'
                : 'Start pedaling. Trainer resistance is unchanged.'}
          </p>
          <button className="secondary" onClick={() => pause()}>
            Cancel countdown
          </button>
        </div>
      )}
      {state.phase === 'paused' && (
        <div className="ride-overlay">
          <div className="pause-card">
            <span className="eyebrow">TAKE YOUR TIME</span>
            <h1>Ride paused.</h1>
            <p>{state.reason}</p>
            {engine.session.source === 'bluetooth' && (
              <p>
                {controlled
                  ? link?.ended
                    ? `${link.message} Resume takes control again${erg ? ' once you pedal above 50 rpm' : ''}.`
                    : `${erg ? 'The trainer is holding a light 50 W.' : 'The trainer is holding a flat road.'} Resume when you are ready.`
                  : 'BikeSIM is reading only. It has not changed trainer resistance.'}
              </p>
            )}
            <button className="primary" onClick={resume}>
              <Play size={18} /> Resume ride <ChevronRight size={18} />
            </button>
            <button className="secondary full" onClick={finish}>
              Finish & save ride
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function MountainBadge() {
  return <span className="route-badge">MX · 01</span>;
}
