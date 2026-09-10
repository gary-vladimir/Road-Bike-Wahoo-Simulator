import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Square } from 'lucide-react';
import { ErgPilot, type PilotSnapshot } from '../trainer/pilot';
import { trainer } from '../trainer/bluetooth';
import { download, loadPilotReport, savePilotReport } from '../storage/store';
import {
  lastPowerAcknowledgement,
  PilotEvidence,
  summarizePlateaus,
  type PilotReport,
} from '../trainer/pilot-evidence';
const initial = (): PilotSnapshot => ({
  state: 'idle',
  applied: 50,
  requested: 50,
  message: '',
  audit: [],
  machineStatus: [],
});
type Props = {
  registerStop: (stop: (() => Promise<void>) | null) => void;
  onActiveChange: (active: boolean) => void;
};
export default function PowerPilot({ registerStop, onActiveChange }: Props) {
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<PilotSnapshot>(initial);
  const [savedReport, setSavedReport] = useState<PilotReport>();
  const [saveError, setSaveError] = useState('');
  const [observationTime, setObservationTime] = useState(performance.now());
  const evidence = useRef(new PilotEvidence());
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const saving = useRef(Promise.resolve());
  const lastSaved = useRef(-Infinity);
  const endedAt = useRef<number | undefined>(undefined);
  const finishedReport = useRef<PilotReport | undefined>(undefined);
  const pilot = useRef<ErgPilot | null>(null),
    mounted = useRef(true),
    attempt = useRef(0);
  const persistEvidence = (report: PilotReport) => {
    saving.current = saving.current
      .then(() => savePilotReport(report))
      .then(() => {
        if (mounted.current) {
          setSavedReport(report);
          setSaveError('');
        }
      })
      .catch(() => {
        if (mounted.current)
          setSaveError(
            'Could not save the test locally. Export the control test log before leaving.',
          );
      });
  };
  useEffect(() => {
    void loadPilotReport()
      .then((report) => {
        if (mounted.current) setSavedReport(report);
      })
      .catch(() => {});
    const timer = setInterval(() => {
      const now = performance.now(),
        current = latest.current;
      evidence.current.record(now, trainer.getSnapshot().telemetry, current);
      setObservationTime(now);
      if (!current.audit.length) return;
      const ended = ['stopped', 'faulted'].includes(current.state);
      if (ended && endedAt.current === undefined) endedAt.current = now;
      if (ended && now - endedAt.current! > 20000) {
        if (!finishedReport.current) {
          finishedReport.current = evidence.current.report(current);
          persistEvidence(finishedReport.current);
        }
        return;
      }
      if (now - lastSaved.current >= 5000 && (!ended || now - endedAt.current! <= 20000)) {
        lastSaved.current = now;
        persistEvidence(evidence.current.report(current));
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!['stopped', 'faulted'].includes(snapshot.state) || !snapshot.audit.length) return;
    const now = performance.now();
    endedAt.current = now;
    evidence.current.record(now, trainer.getSnapshot().telemetry, snapshot);
    lastSaved.current = now;
    persistEvidence(evidence.current.report(snapshot));
  }, [snapshot.state]);
  const stop = useCallback(async () => {
    if (pilot.current) {
      await pilot.current.stop();
      return;
    }
    ++attempt.current;
    setBusy(false);
    setReady(false);
    setSnapshot({
      ...initial(),
      state: 'stopped',
      message: 'Test cancelled. No resistance commands were sent.',
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    registerStop(stop);
    return () => {
      mounted.current = false;
      ++attempt.current;
      registerStop(null);
      void pilot.current?.stop();
    };
  }, [registerStop, stop]);
  const active = busy || ['waiting', 'arming', 'running', 'stopping'].includes(snapshot.state);
  useEffect(() => {
    onActiveChange(active);
  }, [active, onActiveChange]);
  const acknowledged = lastPowerAcknowledgement(snapshot);
  const acknowledgedWatts = acknowledged?.watts ?? null;
  const plateaus = finishedReport.current?.plateaus ?? summarizePlateaus(evidence.current.samples);
  const observed = evidence.current.samples.at(-1);
  return (
    <section className="panel power-pilot">
      <div className="eyebrow">SUPERVISED HARDWARE CHECK</div>
      <h2>Check ERG target response.</h2>
      <p>
        Click Start, then pedal up to 50 rpm. The test waits without changing resistance until fresh
        power and cadence arrive. It starts at 50 W, with gradual changes up to 100 W. Space or
        Escape stops the test. ERG adjusts braking to hold the requested total watts. It can reduce
        your previous load. At the same steady cadence, 100 W should require more pedal effort than
        50 W; a soft feel alone does not establish whether a target is being followed.
      </p>
      <p>
        Stop cancels a waiting test or sends the trainer stop command. Telemetry stays connected
        after an acknowledged stop. If a command fails, the connection may close and load may
        remain. The rider has observed heavier resistance returning after this test ends; Stop is
        not an unload button.
      </p>
      <p>
        Use the small front chainring and a middle rear cog for this diagnostic. Keep a comfortable,
        steady cadence above 50 rpm; you do not need to spin fast or chase watts. Hold each target
        for 20 seconds after acknowledgement if comfortable. The first 10 seconds allow settling.
        Falling below 50 rpm ends the test and can bring back the previous heavier feel.
      </p>
      <label className="pilot-consent">
        <input
          type="checkbox"
          checked={ready}
          disabled={active}
          onChange={(e) => setReady(e.target.checked)}
        />{' '}
        I’m on the bike and ready for this 50–100 W test.
      </label>
      <div className="pilot-actions">
        <button
          className="primary"
          disabled={!ready || active || device.status !== 'connected'}
          onClick={async () => {
            const current = ++attempt.current;
            pilot.current = null;
            setBusy(true);
            setError('');
            evidence.current.begin(performance.now());
            endedAt.current = undefined;
            finishedReport.current = undefined;
            lastSaved.current = -Infinity;
            setSnapshot(initial());
            try {
              const session = await ErgPilot.prepare(trainer.getPilotDevice(), (state) => {
                if (!mounted.current || attempt.current !== current) return;
                latest.current = state;
                setSnapshot(state);
                if (state.state === 'stopped' || state.state === 'faulted') setReady(false);
              });
              if (!mounted.current || attempt.current !== current) {
                await session.stop();
                return;
              }
              pilot.current = session;
              await session.start();
            } catch (err) {
              if (mounted.current && attempt.current === current) {
                setError((err as Error).message);
                setReady(false);
              }
            } finally {
              if (mounted.current && attempt.current === current) setBusy(false);
            }
          }}
        >
          Start 50 W test
        </button>
        {[50, 75, 100].map((watts) => (
          <button
            className="secondary"
            key={watts}
            aria-pressed={snapshot.requested === watts}
            disabled={snapshot.state !== 'running'}
            onClick={() => pilot.current?.setTarget(watts)}
          >
            {watts} W
          </button>
        ))}
        <button
          className="stop-button"
          disabled={!active || snapshot.state === 'stopping'}
          onClick={() => void stop()}
        >
          <Square size={15} />
          {snapshot.state === 'stopping' ? 'Stopping trainer…' : 'Stop trainer test'}
        </button>
      </div>
      <div className="diagnostic-metrics pilot-response" aria-label="ERG response measurements">
        <div>
          <strong>{snapshot.requested}</strong>
          <span>selected W</span>
        </div>
        <div>
          <strong>{acknowledgedWatts ?? '—'}</strong>
          <span>acknowledged W</span>
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
      {snapshot.state === 'running' && acknowledged && (
        <p className="pilot-hold" role="status">
          {snapshot.requested !== acknowledged.watts
            ? `Ramping toward ${snapshot.requested} W. The selected target is not yet acknowledged.`
            : `${Math.max(0, Math.floor((observationTime - acknowledged.at) / 1000))} seconds at acknowledged ${acknowledged.watts} W. Keep your cadence steady if comfortable.`}
        </p>
      )}
      <p role="status">
        {busy && snapshot.state === 'idle' ? 'Preparing test…' : snapshot.state} ·{' '}
        {acknowledgedWatts === null
          ? 'no power target acknowledged'
          : `last acknowledged target ${acknowledgedWatts} W`}
      </p>
      {snapshot.message && <p role="status">{snapshot.message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {device.status !== 'connected' && <p>Connect the trainer above before starting a test.</p>}
      {plateaus.length > 0 && (
        <div className="pilot-table-wrap">
          <table className="pilot-table">
            <caption>
              Target response · averages exclude the first 10 seconds and stale or repeated packets
            </caption>
            <thead>
              <tr>
                <th>Target</th>
                <th>Observed</th>
                <th>Settled power</th>
                <th>Settled cadence</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {plateaus.map((p) => (
                <tr key={p.at}>
                  <td>{p.target} W</td>
                  <td>{p.observedSeconds.toFixed(0)} s</td>
                  <td>
                    {p.averagePower === null ? 'Not enough data' : `${p.averagePower.toFixed(1)} W`}
                  </td>
                  <td>{p.averageCadence === null ? '—' : `${p.averageCadence.toFixed(1)} rpm`}</td>
                  <td>{p.settledSamples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine-print">
        Measured values come from the trainer and may include its power smoothing. Command
        acceptance and these averages do not independently verify physical load. Keep this screen
        open for 15 seconds after Stop to capture the return to the previous feel; no need to keep
        pedaling if uncomfortable.
      </p>
      {saveError && (
        <p className="error" role="alert">
          {saveError}
        </p>
      )}
      {snapshot.audit.length > 0 && (
        <button
          className="secondary"
          onClick={() =>
            download(
              'bikesim-control-test.json',
              JSON.stringify(finishedReport.current ?? evidence.current.report(snapshot), null, 2),
            )
          }
        >
          <Download size={15} /> Export control test log
        </button>
      )}
      {savedReport && (
        <button
          className="secondary"
          onClick={() =>
            download('bikesim-saved-control-test.json', JSON.stringify(savedReport, null, 2))
          }
        >
          <Download size={15} /> Export last saved test
        </button>
      )}
      <p className="fine-print">
        Test evidence saves locally every five seconds, on test end, and for 20 seconds afterward.
        Reload never resumes control. Saved test evidence has a separate export and is not included
        in ride backups.
      </p>
    </section>
  );
}
