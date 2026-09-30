import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Square } from 'lucide-react';
import { TrainerSession, type ControlMode, type SessionSnapshot } from '../trainer/session';
import { trainer } from '../trainer/bluetooth';
import { download, loadControlReport, saveControlReport } from '../storage/store';
import {
  ControlEvidence,
  lastGradeAcknowledgement,
  lastPowerAcknowledgement,
  summarizePlateaus,
  type ControlReport,
} from '../trainer/evidence';

const idle = (mode: ControlMode): SessionSnapshot => ({
  state: 'waiting',
  mode,
  message: '',
  recovery: false,
  stopConfirmed: false,
  releaseConfirmed: false,
  audit: [],
  machineStatus: [],
});

/**
 * Manual trainer check: small, bounded ERG (50–100 W) or SIM (±1%) steps with measured,
 * requested and acknowledged values side by side, and an exportable evidence log.
 */
export default function ControlCheck({
  canControl,
  registerStop,
  onActiveChange,
}: {
  canControl: boolean;
  registerStop: (stop: (() => Promise<void>) | null) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [mode, setMode] = useState<ControlMode>('sim');
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => idle('sim'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedReport, setSavedReport] = useState<ControlReport>();
  const [, setObservationTime] = useState(0);
  const evidence = useRef(new ControlEvidence());
  const session = useRef<TrainerSession | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const lastSaved = useRef(-Infinity);
  const started = session.current !== null;
  // Before a check starts, the placeholder snapshot is not a live session.
  const active =
    busy || (started && ['waiting', 'arming', 'active', 'holding'].includes(snapshot.state));
  const save = (report: ControlReport) =>
    void saveControlReport(report)
      .then(() => setSavedReport(report))
      .catch(() => setError('Could not save the check locally. Export the log before leaving.'));
  useEffect(() => {
    void loadControlReport()
      .then(setSavedReport)
      .catch(() => {});
    const timer = setInterval(() => {
      const now = performance.now();
      evidence.current.record(now, trainer.getSnapshot().telemetry, latest.current);
      setObservationTime(now);
      if (latest.current.audit.length && now - lastSaved.current > 5000) {
        lastSaved.current = now;
        save(evidence.current.report(latest.current));
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);
  const end = useCallback(async (how: 'release' | 'stop' = 'release') => {
    const s = session.current;
    if (!s) return;
    await (how === 'stop' ? s.stop() : s.release());
    save(evidence.current.report(latest.current));
  }, []);
  useEffect(() => {
    registerStop(() => end());
    return () => {
      registerStop(null);
      void session.current?.release();
    };
  }, [registerStop, end]);
  useEffect(() => onActiveChange(active), [active, onActiveChange]);
  const start = async () => {
    setError('');
    setBusy(true);
    evidence.current.begin(performance.now());
    try {
      session.current = await TrainerSession.open(
        trainer.controlSource(mode),
        { mode, purpose: 'diagnostic' },
        setSnapshot,
      );
      session.current.follow(mode === 'erg' ? 50 : 0);
    } catch (e) {
      session.current = null;
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ackWatts = lastPowerAcknowledgement(snapshot)?.watts ?? null;
  const ackGrade = lastGradeAcknowledgement(snapshot)?.grade ?? null;
  const requested = mode === 'erg' ? snapshot.requestedWatts : snapshot.requestedGrade;
  const observed = evidence.current.samples.at(-1);
  const plateaus = summarizePlateaus(evidence.current.samples);
  const running = snapshot.state === 'active' || snapshot.state === 'holding';
  return (
    <div className="stack" style={{ gap: 14, marginTop: 14 }}>
      <h2>{mode === 'sim' ? 'Feel small slope changes.' : 'Feel small power targets.'}</h2>
      <div className="segmented" aria-label="Trainer check mode">
        {(['sim', 'erg'] as const).map((m) => (
          <button
            key={m}
            aria-pressed={mode === m}
            disabled={active}
            onClick={() => {
              setMode(m);
              setSnapshot(idle(m));
              session.current = null;
              evidence.current = new ControlEvidence();
            }}
          >
            {m === 'sim' ? 'SIM · slope' : 'ERG · watts'}
          </button>
        ))}
      </div>
      <p>
        {mode === 'sim'
          ? 'Starts on a flat road. Try −1% to +1% and shift as you like; coasting is fine.'
          : 'Starts at 50 W once you pedal above 50 rpm. Keep a steady cadence in the small chainring and a middle cog; ERG holds the watts, so pedaling faster feels lighter.'}{' '}
        End on a flat road keeps the trainer easy. FTMS Stop hands the KICKR back to its own default
        load, which has felt heavier.
      </p>
      <div className="control-check-actions">
        <button
          className="btn btn-primary"
          disabled={!canControl || active || device.status !== 'connected'}
          onClick={() => void start()}
        >
          {mode === 'sim' ? 'Start on a flat road' : 'Start at 50 W'}
        </button>
        {(mode === 'sim' ? [-1, -0.5, 0, 0.5, 1] : [50, 75, 100]).map((value) => (
          <button
            className="btn btn-s"
            key={value}
            aria-pressed={running && requested === value}
            disabled={!running}
            onClick={() => session.current?.follow(value)}
          >
            {value}
            {mode === 'sim' ? '%' : ' W'}
          </button>
        ))}
      </div>
      <div className="control-check-actions">
        <button className="btn btn-s" disabled={!started || !active} onClick={() => void end()}>
          End on a flat road
        </button>
        <button
          className="btn btn-s btn-danger"
          disabled={!started || !active}
          onClick={() => void end('stop')}
        >
          <Square size={14} /> Send FTMS Stop
        </button>
      </div>
      {!canControl && <p className="notice">Turn on trainer control in Settings first.</p>}
      <div className="diagnostic-metrics" aria-label="Trainer check measurements">
        <div>
          <strong>{requested ?? '—'}</strong>
          <span>{mode === 'sim' ? 'selected slope %' : 'selected W'}</span>
        </div>
        <div>
          <strong>{(mode === 'sim' ? ackGrade : ackWatts) ?? '—'}</strong>
          <span>{mode === 'sim' ? 'acknowledged slope %' : 'acknowledged W'}</span>
        </div>
        <div>
          <strong>{observed?.power ?? '—'}</strong>
          <span>measured W</span>
        </div>
        <div>
          <strong>{observed?.cadence ?? '—'}</strong>
          <span>measured rpm</span>
        </div>
      </div>
      <p role="status">
        {busy ? 'Preparing…' : started ? snapshot.state : 'Not started'}
        {snapshot.message ? ` · ${snapshot.message}` : ''}
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {mode === 'erg' && plateaus.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <caption>Target response · averages skip the first 10 s after each change.</caption>
            <thead>
              <tr>
                <th>Target</th>
                <th>Held</th>
                <th>Power after 10 s</th>
                <th>Cadence after 10 s</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {plateaus.map((p) => (
                <tr key={p.at}>
                  <td>{p.target} W</td>
                  <td>{p.observedSeconds.toFixed(0)} s</td>
                  <td>{p.averagePower === null ? '—' : `${p.averagePower.toFixed(1)} W`}</td>
                  <td>{p.averageCadence === null ? '—' : `${p.averageCadence.toFixed(1)} rpm`}</td>
                  <td>{p.settledSamples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="control-check-actions">
        {snapshot.audit.length > 0 && (
          <button
            className="btn btn-s"
            onClick={() =>
              download(
                'bikesim-trainer-check.json',
                JSON.stringify(evidence.current.report(snapshot), null, 2),
              )
            }
          >
            <Download size={15} /> Export this check
          </button>
        )}
        {savedReport && (
          <button
            className="btn btn-s"
            onClick={() =>
              download('bikesim-last-trainer-check.json', JSON.stringify(savedReport, null, 2))
            }
          >
            <Download size={15} /> Export last saved check
          </button>
        )}
      </div>
    </div>
  );
}
