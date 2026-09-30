import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { trainer } from '../trainer/bluetooth';
import { TrainerSession } from '../trainer/session';
import { lastPowerAcknowledgement } from '../trainer/evidence';
import { FtpControl } from '../ride/ftp-control';
import {
  ftpProtocols,
  ftpTarget,
  ftpRampStart,
  ftpWarmupSeconds,
  type FtpAssessment,
  type FtpProtocol,
  type FtpStartingLoad,
} from '../ride/ftp-test';
import { download, loadFtpAssessments, saveFtpAssessment } from '../storage/store';
import { clock, countdown } from '../workouts/model';
import { Stat } from './kit';

export default function FtpTest({
  canControl,
  onClose,
}: {
  canControl: boolean;
  onClose: () => void;
}) {
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [protocol, setProtocol] = useState<FtpProtocol>('gentle');
  const [startingLoad, setStartingLoad] = useState<FtpStartingLoad>(50);
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
    const interval = setInterval(() => {
      const c = controller.current;
      if (!c) return;
      if (document.hidden) {
        // Leaving the page mid-ramp ends the test with the data so far; warm-up just waits.
        if (c.phase === 'running' && c.ramp)
          void c.finish('effort', 'The test ended when BikeSIM was hidden.');
        else c.hold();
        return;
      }
      c.tick(trainer.getSnapshot().telemetry);
    }, 250);
    const checkpoint = setInterval(() => {
      const c = controller.current;
      if (c && ['waiting', 'running'].includes(c.phase)) persist(c.report);
    }, 5000);
    const keys = (e: KeyboardEvent) => {
      const c = controller.current;
      if (e.code !== 'Escape' || !c || !['waiting', 'running'].includes(c.phase)) return;
      e.preventDefault();
      void c.finish(c.ramp ? 'effort' : 'cancel');
    };
    window.addEventListener('keydown', keys);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(checkpoint);
      window.removeEventListener('keydown', keys);
      if (controller.current && controller.current.phase !== 'finished')
        void controller.current.finish('cancel');
    };
  }, []);
  const start = async () => {
    if (controller.current) return;
    setError('');
    try {
      const source = trainer.controlSource('erg');
      const c = new FtpControl(
        protocol,
        (update) =>
          TrainerSession.open(
            source,
            {
              mode: 'erg',
              powerCeiling: ftpProtocols[protocol].ceiling,
              startupWatts: startingLoad,
            },
            update,
          ),
        changed,
        () => performance.now(),
        startingLoad,
        () => trainer.getSnapshot().telemetry,
      );
      controller.current = c;
      // Persist before control starts, so a reload leaves an interrupted attempt, never an FTP.
      writes.current = saveFtpAssessment(structuredClone(c.report));
      await writes.current;
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
  const ramp = c?.ramp ?? false;
  const p = ftpProtocols[protocol];
  const ack = c?.snapshot && lastPowerAcknowledgement(c.snapshot);
  const fresh =
    device.telemetry.powerAt !== undefined && performance.now() - device.telemetry.powerAt < 3000;
  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">Know your effort</span>
          <h1 className="page-title">Find your FTP.</h1>
          <p className="lede">
            FTP is the power you can sustain for about an hour. It personalizes every workout. No
            previous FTP is needed.
          </p>
        </div>
      </div>
      {!c && (
        <section className="card">
          <h2>A guided ramp test</h2>
          <p>
            Warm up for 5 minutes at {startingLoad} W, then the target rises every minute from{' '}
            {ftpRampStart(protocol, startingLoad)} W. Ride until you cannot hold the step, then
            press <strong>I’ve reached my limit</strong>. Your FTP is 75% of your best minute.
          </p>
          <label>
            Test protocol
            <select
              aria-label="FTP test protocol"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as FtpProtocol)}
            >
              <option value="gentle">Gentle ramp · +10 W each minute · up to 300 W</option>
              <option value="standard">Standard ramp · +20 W each minute · up to 600 W</option>
            </select>
          </label>
          <label>
            Starting load
            <select
              aria-label="FTP starting load"
              value={startingLoad}
              onChange={(e) => setStartingLoad(Number(e.target.value) as FtpStartingLoad)}
            >
              <option value={50}>50 W · very light</option>
              <option value={75}>75 W · more pedal pressure</option>
              <option value={100}>100 W · if 75 W still feels too easy</option>
            </select>
          </label>
          <ul className="tips">
            <li>Stay seated in the small chainring and a middle cog. Keep a steady cadence.</li>
            <li>
              ERG holds the watts: pedaling faster makes it lighter, not harder. Don’t chase numbers
              with your legs.
            </li>
            <li>
              Short cadence dropouts are ignored. If you stop pedaling during warm-up, the clock
              waits at a light load. During the ramp, a few seconds below 50 rpm ends the test and
              calculates your result.
            </li>
            <li>Choose a rested day, have a fan and water ready, and stop if you feel unwell.</li>
          </ul>
          <button
            className="btn btn-primary btn-l"
            disabled={!canControl || device.status !== 'connected' || !fresh}
            onClick={() => void start()}
          >
            Start FTP test
          </button>
          {!canControl ? (
            <p className="notice">Turn on trainer control in Settings to run the FTP test.</p>
          ) : device.status !== 'connected' ? (
            <p className="notice">Pair your KICKR in Trainer before starting.</p>
          ) : (
            !fresh && <p className="notice">Pedal gently so BikeSIM sees live power.</p>
          )}
        </section>
      )}
      {active && (
        <section className="card" aria-label="FTP assessment in progress">
          <span className="eyebrow">
            {c.phase === 'waiting'
              ? 'WAITING FOR STEADY PEDALING'
              : c.phase === 'finishing'
                ? 'FINISHING'
                : c.warmupPaused
                  ? 'WARM-UP PAUSED · LIGHT LOAD'
                  : ramp
                    ? 'RAMP · ONE MINUTE AT A TIME'
                    : 'WARM UP'}
          </span>
          <h2>
            {c.phase === 'waiting'
              ? 'Pedal above 50 rpm to begin'
              : c.phase === 'finishing'
                ? 'Easing the trainer to a flat road…'
                : c.warmupPaused
                  ? 'Spin back up to continue'
                  : ramp
                    ? `Step ${Math.floor((report!.elapsed - ftpWarmupSeconds) / 60) + 1}`
                    : 'Find a comfortable rhythm'}
          </h2>
          <div className="ftp-live">
            <Stat
              value={fresh ? (device.telemetry.power ?? '—') : '—'}
              unit="W"
              label="your power"
            />
            <Stat value={device.telemetry.cadence ?? '—'} unit="rpm" label="cadence" />
            <Stat
              value={ftpTarget(protocol, report!.elapsed, report!.startingLoad)}
              unit="W"
              label="target"
            />
            <Stat value={ack?.watts ?? '—'} unit="W" label="trainer set to" />
          </div>
          <p>
            {clock(report!.elapsed)} elapsed ·{' '}
            {countdown(
              ramp
                ? 60 - ((report!.elapsed - ftpWarmupSeconds) % 60)
                : ftpWarmupSeconds - report!.elapsed,
            )}{' '}
            until the next step
          </p>
          <progress
            aria-label="Current FTP stage progress"
            max={ramp ? 60 : ftpWarmupSeconds}
            value={ramp ? (report!.elapsed - ftpWarmupSeconds) % 60 : report!.elapsed}
          />
          <p>{c.snapshot?.message}</p>
          <div className="row">
            <button
              className="btn btn-primary btn-l"
              disabled={c.phase !== 'running' || !ramp}
              onClick={() => void c.finish('effort')}
            >
              I’ve reached my limit
            </button>
            <button
              className="btn"
              disabled={c.phase === 'finishing'}
              onClick={() => void c.finish('cancel')}
            >
              Cancel test
            </button>
          </div>
          <p className="fine">
            Esc ends the test. When it ends, the trainer eases to a flat road so you can cool down.
          </p>
        </section>
      )}
      {c?.phase === 'finished' && (
        <section className="card" aria-label="FTP assessment result">
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
                : 'Attempt saved. Your previous FTP was kept.'
              : 'Saving assessment…'}
          </p>
          <p>
            {report!.stopConfirmed
              ? 'The trainer is on a flat road. Spin easy to cool down.'
              : 'The trainer did not confirm the flat road. Check the trainer before continuing.'}
          </p>
          <button
            className="btn"
            onClick={() =>
              download(`bikesim-ftp-${report!.id}.json`, JSON.stringify(report, null, 2))
            }
          >
            Download assessment JSON
          </button>
          {!saved && error && (
            <button className="btn" onClick={() => persist(report!, true)}>
              Retry saving result
            </button>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      {!active && (
        <button className="btn" onClick={() => void writes.current.catch(() => {}).then(onClose)}>
          Back to BikeSIM
        </button>
      )}
      {!active && history.length > 0 && (
        <section className="card">
          <h2>Assessment history</h2>
          {history.map((r) => (
            <div key={r.id} className="stack" style={{ gap: 6 }}>
              <strong>
                {new Date(r.startedAt).toLocaleDateString()} · {ftpProtocols[r.protocol].name}
              </strong>
              <p>
                {r.ftp ? `${r.ftp} W estimated FTP` : r.status} · {clock(r.elapsed)}
              </p>
              <p>{r.reason}</p>
              <button
                className="btn"
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
