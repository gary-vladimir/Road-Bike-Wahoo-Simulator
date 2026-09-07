import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronRight, Maximize, Minus, Pause, Play, Plus, Square } from 'lucide-react';
import RoadScene from '../scene/RoadScene';
import Profile from './Profile';
import { clock, position, totalSeconds } from '../workouts/model';
import { RideEngine, type Session } from '../ride/engine';
import { trainer } from '../trainer/bluetooth';
import { saveSession } from '../storage/store';

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
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const container = useRef<HTMLDivElement>(null);
  const queue = useRef(Promise.resolve());
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
    void persist();
    let lastSave = performance.now();
    const timer = setInterval(() => {
      engine.tick(performance.now(), trainer.snapshot.telemetry);
      setState({ ...engine.state });
      if (performance.now() - lastSave > 5000) {
        lastSave = performance.now();
        void persist();
      }
      if (engine.state.phase === 'finished') {
        clearInterval(timer);
        void persist().then(() => onFinish(structuredClone(engine.session)));
      }
    }, 100);
    const hidden = () => {
      if (document.hidden) {
        engine.pause('The ride paused while this tab was hidden.');
        void persist();
        setState({ ...engine.state });
      }
    };
    const keys = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        engine.pause('Stopped by keyboard. Resume deliberately when ready.');
        void persist();
        setState({ ...engine.state });
      }
    };
    const leaving = (e: BeforeUnloadEvent) => {
      if (engine.state.phase !== 'finished') {
        engine.pause('Page closed or refreshed');
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('keydown', keys);
    window.addEventListener('beforeunload', leaving);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('keydown', keys);
      window.removeEventListener('beforeunload', leaving);
    };
  }, [engine, sceneReady]);
  const current = position(engine.session.workout, state.elapsed),
    next = engine.session.workout.blocks[current.index + 1];
  const pause = () => {
    engine.pause();
    setState({ ...engine.state });
    void persist();
  };
  const resume = () => {
    engine.resume();
    setState({ ...engine.state });
  };
  const finish = () => {
    engine.finish();
    setState({ ...engine.state });
  };
  return (
    <div className="ride-screen" data-quality={quality} ref={container}>
      <div className="ride-world">
        <RoadScene
          speed={state.speed}
          grade={state.grade}
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
              : 'LIVE POWER · RESISTANCE NOT CONTROLLED'}
          </span>
          <h2>{engine.session.workout.name}</h2>
        </div>
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
      <div className="ride-metrics">
        <div className="power-metric">
          <span>POWER</span>
          <strong>
            {state.power ?? '—'}
            <small>W</small>
          </strong>
          <div>
            Target <b>{state.target || Math.round(current.target * engine.session.ftp)} W</b>
          </div>
        </div>
        <div>
          <span>CADENCE</span>
          <strong>
            {state.cadence ?? '—'}
            <small>rpm</small>
          </strong>
          <div>Aim for {current.block.cadence} rpm</div>
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
        <strong>Oaxaca foothills</strong>
        <span>Procedural workout road</span>
        <div>
          <b>{state.grade.toFixed(1)}%</b> visual grade
        </div>
      </div>
      {(storageError || fullscreenError) && (
        <div className="ride-warning" role="alert">
          {storageError || fullscreenError}
        </div>
      )}
      <div className="ride-bottom">
        <div className="interval-line">
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
                ? `${clock(next.seconds)} · ${Math.round(next.to * engine.session.ftp * state.bias)} W`
                : 'Time to cool off.'}
            </small>
          </div>
        </div>
        <Profile workout={engine.session.workout} elapsed={state.elapsed} />
        <div className="ride-controls">
          <span className="ride-time">
            {clock(state.elapsed)} <span>/ {clock(totalSeconds(engine.session.workout))}</span>
          </span>
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
              void persist();
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
            {sceneReady ? Math.ceil(state.countdown) : '…'}
          </strong>
          <p>
            {engine.session.source === 'demo'
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
              <p>BikeSIM is reading only. It has not changed trainer resistance.</p>
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
