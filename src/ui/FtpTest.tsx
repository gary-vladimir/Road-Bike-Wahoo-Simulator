import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { trainer } from '../trainer/bluetooth';
import { ErgPilot } from '../trainer/pilot';
import { lastPowerAcknowledgement } from '../trainer/pilot-evidence';
import { FtpControl } from '../ride/ftp-control';
import {
  ftpProtocols,
  ftpTarget,
  ftpWarmupSeconds,
  type FtpAssessment,
  type FtpProtocol,
} from '../ride/ftp-test';
import { download, loadFtpAssessments, saveFtpAssessment } from '../storage/store';
import { clock } from '../workouts/model';

export default function FtpTest({ onClose }: { onClose: () => void }) {
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [protocol, setProtocol] = useState<FtpProtocol>('gentle');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<FtpAssessment[]>([]);
  const [, render] = useState(0);
  const controller = useRef<FtpControl | null>(null);
  const writes = useRef(Promise.resolve());
  const finalQueued = useRef(false);
  const mounted = useRef(true);
  const persist = (report: FtpAssessment, final = false) => {
    const copy = structuredClone(report);
    writes.current = writes.current
      .catch(() => {})
      .then(() => saveFtpAssessment(copy, final && copy.status === 'estimated'));
    void writes.current
      .then(() => {
        if (final && mounted.current) {
          setSaved(true);
          setError('');
          void loadFtpAssessments()
            .then(setHistory)
            .catch(() => setError('Result saved, but history could not be refreshed.'));
        }
      })
      .catch(() => {
        if (mounted.current)
          setError('Could not save locally. Download the report, then retry saving.');
      });
  };
  const changed = () => {
    if (!mounted.current) return;
    render((n) => n + 1);
    const c = controller.current;
    if (c?.phase === 'finished' && !finalQueued.current) {
      finalQueued.current = true;
      persist(c.report, true);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void loadFtpAssessments()
      .then(setHistory)
      .catch(() => setError('Assessment history could not be loaded.'));
    const interval = setInterval(
      () => controller.current?.tick(trainer.getSnapshot().telemetry),
      250,
    );
    const checkpoint = setInterval(() => {
      const c = controller.current;
      if (c && ['waiting', 'running'].includes(c.phase)) persist(c.report);
    }, 5000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(checkpoint);
      if (controller.current && controller.current.phase !== 'finished')
        void controller.current.finish('cancel');
    };
  }, []);
  const start = async () => {
    if (controller.current || !ready) return;
    setError('');
    try {
      const source = trainer.getPilotDevice('erg');
      const c = new FtpControl(
        protocol,
        (update) =>
          ErgPilot.prepare(source, update, 'erg', 'workout', ftpProtocols[protocol].ceiling),
        changed,
      );
      controller.current = c;
      // Persist before preparing control, so reloads leave an interrupted attempt, never an FTP.
      writes.current = saveFtpAssessment(structuredClone(c.report));
      await writes.current;
      if (c.phase !== 'waiting') return;
      changed();
      await c.start();
    } catch (e) {
      setError((e as Error).message);
      if (controller.current) void controller.current.finish('fault', (e as Error).message);
    }
  };
  const c = controller.current;
  const report = c?.report;
  const active = c && c.phase !== 'finished';
  const ramp = (report?.elapsed ?? 0) >= ftpWarmupSeconds;
  const p = ftpProtocols[protocol];
  const ack = c?.snapshot && lastPowerAcknowledgement(c.snapshot);
  return (
    <main className="content-page ftp-test">
      <div className="eyebrow">KNOW YOUR EFFORT</div>
      <h1>Find your FTP.</h1>
      <p>
        FTP is an estimate of the power you can sustain during a hard, prolonged effort. It
        personalizes your workouts. No previous FTP is needed.
      </p>
      {!c && (
        <section className="panel settings-form">
          <h2>A guided ramp test</h2>
          <p>
            Warm up for 5 minutes at 50 W, then follow one-minute steps until you reach your limit.
            Stay seated, use the small front chainring and a middle rear cog, and keep a steady
            cadence above 50 rpm.
          </p>
          <label>
            Test protocol
            <select
              aria-label="FTP test protocol"
              value={protocol}
              onChange={(e) => {
                setProtocol(e.target.value as FtpProtocol);
                setReady(false);
              }}
            >
              <option value="gentle">Gentle ramp · +10 W each minute · 50–300 W</option>
              <option value="standard">Standard ramp · +20 W each minute · 100–600 W</option>
            </select>
          </label>
          <p>
            Gentle uses smaller steps for riders new to power training. Both tests become demanding.
            Choose a rested day, have cooling and water ready, and stop if you feel unwell.
          </p>
          <p>
            Press <strong>I’ve reached my limit</strong> when you can no longer sustain the effort.
            We calculate 75% of your best measured 60-second ramp power and automatically save a
            valid estimate to Settings. This is an estimate, not an exact physiological measurement.
          </p>
          <p className="fine-print">
            At least three ramp minutes are required. Cancel, connection loss, cadence below 50 rpm,
            tab switching, or reaching the test ceiling without declaring your limit will leave FTP
            unchanged. There is no pause/resume or intensity adjustment during an assessment.
          </p>
          <label>
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />{' '}
            I’m ready for a demanding test, my trainer profile and current load are comfortable,
            other trainer apps are closed, and I want a valid result to update my FTP.
          </label>
          <button
            className="primary"
            disabled={
              !ready ||
              device.status !== 'connected' ||
              import.meta.env.VITE_TRAINER_CONTROL !== 'pilot'
            }
            onClick={() => void start()}
          >
            Start FTP test
          </button>
          {device.status !== 'connected' && <p>Pair your KICKR in Trainer before starting.</p>}
          {import.meta.env.VITE_TRAINER_CONTROL !== 'pilot' && (
            <p>Automatic trainer control is disabled in this build.</p>
          )}
        </section>
      )}
      {active && (
        <section className="panel" aria-label="FTP assessment in progress">
          <div className="eyebrow">
            {c.phase === 'waiting'
              ? 'WAITING FOR STEADY PEDALING'
              : c.phase === 'stopping'
                ? 'STOPPING TRAINER'
                : ramp
                  ? 'RAMP · ONE MINUTE AT A TIME'
                  : 'WARM UP'}
          </div>
          <h2>
            {c.phase === 'waiting'
              ? 'Pedal above 50 rpm to begin'
              : c.phase === 'stopping'
                ? 'Ending your test…'
                : ramp
                  ? `Step ${Math.floor((report!.elapsed - ftpWarmupSeconds) / 60) + 1}`
                  : 'Find a comfortable rhythm'}
          </h2>
          <div className="ftp-metrics">
            <div>
              <strong>{device.telemetry.power ?? '—'} W</strong>
              <span>Measured power</span>
            </div>
            <div>
              <strong>{device.telemetry.cadence ?? '—'} rpm</strong>
              <span>Cadence</span>
            </div>
            <div>
              <strong>{ftpTarget(protocol, report!.elapsed)} W</strong>
              <span>Requested target</span>
            </div>
            <div>
              <strong>{ack?.watts ?? '—'} W</strong>
              <span>Acknowledged target</span>
            </div>
          </div>
          <p>
            {clock(report!.elapsed)} elapsed ·{' '}
            {clock(
              ramp
                ? 60 - ((report!.elapsed - ftpWarmupSeconds) % 60)
                : ftpWarmupSeconds - report!.elapsed,
            )}{' '}
            until next step
          </p>
          <progress
            aria-label="Current FTP stage progress"
            max={ramp ? 60 : ftpWarmupSeconds}
            value={ramp ? (report!.elapsed - ftpWarmupSeconds) % 60 : report!.elapsed}
          />
          <p>{c.snapshot?.message}</p>
          <p>
            Stay seated. Do not sprint to raise the result. When you reach your limit, finish the
            effort before cadence falls below 50 rpm.
          </p>
          <div className="ftp-actions">
            <button
              className="primary"
              disabled={c.phase !== 'running' || !ramp}
              onClick={() => void c.finish('effort')}
            >
              I’ve reached my limit
            </button>
            <button
              className="danger"
              disabled={c.phase === 'stopping'}
              onClick={() => void c.finish('cancel')}
            >
              Cancel test · Stop trainer
            </button>
          </div>
          <p className="fine-print">
            Escape also stops and invalidates the assessment. Stop may restore the trainer’s
            previous load.
          </p>
        </section>
      )}
      {c?.phase === 'finished' && (
        <section className="panel" aria-label="FTP assessment result">
          <h2>{report!.ftp ? `Estimated FTP: ${report!.ftp} W` : 'FTP unchanged'}</h2>
          <p>{report!.reason}</p>
          {report!.bestMinute && (
            <p>
              Best measured minute: {report!.bestMinute.toFixed(1)} W · {p.name}
            </p>
          )}
          <p role="status">
            {saved
              ? report!.ftp
                ? 'Saved to Settings. Your workouts now use this FTP.'
                : 'Attempt saved. Your previous FTP was preserved.'
              : 'Saving assessment…'}
          </p>
          <p>
            {report!.stopConfirmed
              ? 'Trainer Stop acknowledged. Set a comfortable load before cooling down; Stop can restore a heavier previous load.'
              : 'Trainer load is not confirmed. Check the trainer before continuing.'}
          </p>
          <button
            className="secondary"
            onClick={() =>
              download(`bikesim-ftp-${report!.id}.json`, JSON.stringify(report, null, 2))
            }
          >
            Download assessment JSON
          </button>
          {!saved && error && (
            <button className="secondary" onClick={() => persist(report!, true)}>
              Retry saving result
            </button>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!active && (
        <button
          className="secondary"
          onClick={() => void writes.current.catch(() => {}).then(onClose)}
        >
          Back to BikeSIM
        </button>
      )}
      {!active && history.length > 0 && (
        <section className="panel">
          <h2>Assessment history</h2>
          {history.map((r) => (
            <div key={r.id} className="ftp-history">
              <strong>
                {new Date(r.startedAt).toLocaleDateString()} · {ftpProtocols[r.protocol].name}
              </strong>
              <p>
                {r.ftp ? `${r.ftp} W estimated FTP` : r.status} · {clock(r.elapsed)}
              </p>
              <p>{r.reason}</p>
              <button
                className="secondary"
                onClick={() => download(`bikesim-ftp-${r.id}.json`, JSON.stringify(r, null, 2))}
              >
                Download report
              </button>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
