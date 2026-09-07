import { useEffect, useRef, useState } from 'react';
import { Download, Square } from 'lucide-react';
import { ErgPilot, type PilotSnapshot } from '../trainer/pilot';
import { trainer } from '../trainer/bluetooth';
import { download } from '../storage/store';
export default function PowerPilot() {
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<PilotSnapshot>({
    state: 'idle',
    applied: 50,
    message: '',
    audit: [],
  });
  const pilot = useRef<ErgPilot | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void pilot.current?.stop();
    };
  }, []);
  const active = snapshot.state === 'running' || busy;
  return (
    <section className="panel power-pilot">
      <div className="eyebrow">SUPERVISED HARDWARE CHECK</div>
      <h2>Try a small resistance change.</h2>
      <p>
        This test changes trainer resistance. It starts at 50 W and is limited to 100 W, with
        gradual increases. Keep pedaling above 50 rpm. Keyboard Stop: Space or Escape.
      </p>
      <p>
        Stop sends the standard trainer stop command and disconnects. An acknowledgement does not
        prove resistance dropped; confirm the physical response. If communication fails, load may
        remain.
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
          disabled={!ready || active || snapshot.state !== 'idle'}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const session = await ErgPilot.prepare(trainer.getPilotDevice(), (state) => {
                if (mounted.current) setSnapshot(state);
              });
              if (!mounted.current) {
                await session.stop();
                return;
              }
              pilot.current = session;
              await session.start();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              if (mounted.current) setBusy(false);
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
          disabled={!pilot.current}
          onClick={() => void pilot.current?.stop()}
        >
          <Square size={15} /> Stop trainer test
        </button>
      </div>
      <p role="status">
        {busy ? 'Checking and arming…' : snapshot.state} ·{' '}
        {snapshot.audit.some(
          (entry) =>
            entry.event === 'acknowledgement' && entry.bytes?.[0] === 5 && entry.result === 1,
        )
          ? `last acknowledged target ${snapshot.applied} W`
          : 'no power target acknowledged'}
      </p>
      {snapshot.message && <p role="status">{snapshot.message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
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
