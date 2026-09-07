import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Square } from 'lucide-react';
import { ErgPilot, type PilotSnapshot } from '../trainer/pilot';
import { trainer } from '../trainer/bluetooth';
import { download } from '../storage/store';
const initial = (): PilotSnapshot => ({ state: 'idle', applied: 50, message: '', audit: [] });
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
  const pilot = useRef<ErgPilot | null>(null),
    mounted = useRef(true),
    attempt = useRef(0);
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
  const acknowledged = snapshot.audit
    .filter(
      (entry) => entry.event === 'acknowledgement' && entry.bytes?.[0] === 5 && entry.result === 1,
    )
    .at(-1)?.bytes;
  const acknowledgedWatts = acknowledged ? acknowledged[1] | (acknowledged[2] << 8) : null;
  return (
    <section className="panel power-pilot">
      <div className="eyebrow">SUPERVISED HARDWARE CHECK</div>
      <h2>Try a small resistance change.</h2>
      <p>
        Click Start, then pedal up to 50 rpm. The test waits without changing resistance until fresh
        power and cadence arrive. It starts at 50 W, with gradual changes up to 100 W. Space or
        Escape stops the test.
      </p>
      <p>
        Stop cancels a waiting test or sends the trainer stop command. Telemetry stays connected
        after an acknowledged stop. If a command fails, the connection may close and load may
        remain; an acknowledgement alone does not prove physical unloading.
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
            setSnapshot(initial());
            try {
              const session = await ErgPilot.prepare(trainer.getPilotDevice(), (state) => {
                if (!mounted.current || attempt.current !== current) return;
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
      {snapshot.audit.length > 0 && (
        <button
          className="secondary"
          onClick={() => download('bikesim-control-test.json', JSON.stringify(snapshot, null, 2))}
        >
          <Download size={15} /> Export control test log
        </button>
      )}
    </section>
  );
}
