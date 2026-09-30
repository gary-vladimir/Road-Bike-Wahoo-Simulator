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
import { RideControl } from '../ride/ride-control';
import { workoutPowerCeiling } from '../ride/workout-control';
import { ErgPilot } from '../trainer/pilot';
import { lastPowerAcknowledgement } from '../trainer/pilot-evidence';

export default function Ride({
  engine,
  quality,
  onFinish,
}: {
  engine: RideEngine;
  quality: string;
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
  const control = useRef<RideControl | null>(null);
  const controlled = !!engine.session.trainerControl;
  const erg = engine.session.trainerControl === 'erg';
  const refresh = () => setState({ ...engine.state });
  const arm = () => {
    const controller = new RideControl(
      engine,
      (changed) =>
        erg
          ? ErgPilot.prepare(
              trainer.getPilotDevice('erg'),
              changed,
              'erg',
              'workout',
              workoutPowerCeiling(engine.session.workout, engine.session.ftp!),
            )
          : ErgPilot.prepare(trainer.getPilotDevice('sim'), changed, 'sim', 'road'),
      refresh,
    );
    control.current = controller;
    void controller.start();
    refresh();
  };
  const stopControl = () => control.current?.stop() ?? Promise.resolve();
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
  useEffect(() => {
    if (!sceneReady) return;
    if (controlled && engine.state.phase === 'countdown') arm();
    void persist();
    let lastSave = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (!controlled || control.current?.ready) engine.tick(now, trainer.snapshot.telemetry);
      motion.current = {
        distance: engine.state.distance * 1000,
        speed: engine.state.speed,
        at: now,
      };
      control.current?.update();
      setState({ ...engine.state });
      if (performance.now() - lastSave > 5000) {
        lastSave = performance.now();
        void persist();
      }
      if (engine.state.phase === 'finished') {
        clearInterval(timer);
        void stopControl()
          .then(persist)
          .then(() => onFinish(structuredClone(engine.session)));
      }
    }, 100);
    const hidden = () => {
      if (document.hidden) {
        engine.pause('The ride paused while this tab was hidden.');
        void stopControl().then(persist);
        setState({ ...engine.state });
      }
    };
    const keys = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        engine.pause('Stopped by keyboard. Resume deliberately when ready.');
        void stopControl().then(persist);
        setState({ ...engine.state });
      }
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (engine.state.phase !== 'finished') {
        engine.pause('Page closed or refreshed');
        void stopControl().then(persist);
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', keys);
    window.addEventListener('beforeunload', leaving);
    return () => {
      clearInterval(timer);
      void stopControl();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [engine, sceneReady]);
  const current = position(engine.session.workout, state.elapsed),
    next = engine.session.workout.blocks[current.index + 1];
  const route = engine.session.route;
  const terrain = route ? routePosition(route, state.distance * 1000) : null;
  const acknowledgedPower = control.current?.snapshot
    ? lastPowerAcknowledgement(control.current.snapshot)?.watts
    : undefined;
  const coast = coastStatus(state.speed, state.grade, engine.setup);
  const pause = () => {
    engine.pause();
    setState({ ...engine.state });
    void stopControl().then(persist);
  };
  const resume = () => {
    if (controlled && control.current && !control.current.ended) return;
    engine.resume();
    if (controlled && sceneReady) arm();
    setState({ ...engine.state });
  };
  const finish = () => {
    engine.finish();
    setState({ ...engine.state });
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
        <button className="glass-button" onClick={pause}>
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
                <b>{acknowledgedPower ?? '—'} W</b> last acknowledged trainer target
              </>
            ) : (
              <>
                <b>{control.current?.snapshot?.grade?.toFixed(2) ?? '—'}%</b> last acknowledged
                trainer slope
              </>
            )}
            <p>
              {control.current?.ending
                ? 'Stopping trainer…'
                : control.current?.ready
                  ? erg
                    ? 'ERG control active · changes up to 10 W/s'
                    : 'Terrain control active'
                  : (control.current?.message ?? 'Waiting for road preparation')}
            </p>
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
          <button className="secondary" onClick={pause}>
            <Pause size={16} /> Pause
          </button>
          <button
            className="stop-button"
            onClick={() => {
              engine.pause('Stop requested. The simulator is paused.');
              setState({ ...engine.state });
              void stopControl().then(persist);
            }}
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
            {sceneReady && (!controlled || control.current?.ready)
              ? Math.ceil(state.countdown)
              : '…'}
          </strong>
          <p>
            {controlled
              ? control.current?.ready
                ? erg
                  ? '50 W ERG is active. Keep pedaling above 50 rpm; workout targets follow after the countdown.'
                  : 'Flat SIM is active. Shift to a comfortable gear; terrain follows after the countdown.'
                : (control.current?.message ?? 'Preparing trainer. The ride clock is waiting.')
              : engine.session.source === 'demo'
                ? 'Demo rider starting. No trainer commands.'
                : 'Start pedaling. Trainer resistance is unchanged.'}
          </p>
          <button className="secondary" onClick={pause}>
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
                  ? `${control.current?.ending ? 'Stopping trainer…' : (control.current?.message ?? '')} Stop may restore a heavier load. Resume deliberately when comfortable; it will start with ${erg ? '50 W ERG once cadence reaches 50 rpm' : 'flat SIM'}.`
                  : 'BikeSIM is reading only. It has not changed trainer resistance.'}
              </p>
            )}
            <button
              className="primary"
              onClick={resume}
              disabled={controlled && !!control.current && !control.current.ended}
            >
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
