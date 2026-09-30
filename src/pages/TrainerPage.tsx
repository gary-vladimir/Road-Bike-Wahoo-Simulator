import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bluetooth, Download, Unplug } from 'lucide-react';
import { trainer } from '../trainer/bluetooth';
import { download, type Settings } from '../storage/store';
import ControlCheck from '../ui/ControlCheck';
import { Stat } from '../ui/kit';

export default function TrainerPage({
  settings,
  onOpenSettings,
}: {
  settings: Settings;
  onOpenSettings: () => void;
}) {
  const canControl = settings.trainerControl === true;
  const stopCheck = useRef<(() => Promise<void>) | null>(null);
  const registerStop = useCallback((stop: (() => Promise<void>) | null) => {
    stopCheck.current = stop;
  }, []);
  const [checking, setChecking] = useState(false);
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const t = device.telemetry;
  const fresh = (at?: number) => at !== undefined && now - at < 3000;
  const connected = device.status === 'connected';
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Your connection</span>
          <h1 className="page-title">Trainer</h1>
          <p className="lede">
            Pair the KICKR CORE 2 over Bluetooth in Chrome on this Mac. Pairing only reads power and
            cadence; the load changes only during rides you start with trainer control on.
          </p>
        </div>
      </div>
      <div className="connection">
        <section className="card">
          <div className="connection-status" role="status">
            <span
              className={`dot ${connected ? 'live' : device.status === 'connecting' ? 'busy' : device.status === 'error' ? 'error' : ''}`}
            />
            <strong>
              {connected
                ? fresh(t.powerAt)
                  ? `${device.name} · live`
                  : `${device.name} · pedal to see power`
                : device.status === 'connecting'
                  ? 'Connecting…'
                  : 'Not connected'}
            </strong>
          </div>
          <p className="muted">
            {checking ? 'Manual trainer check running below.' : device.message}
          </p>
          <div className="row">
            {connected ? (
              <button
                className="btn"
                onClick={async () => {
                  await stopCheck.current?.();
                  trainer.disconnect();
                }}
              >
                <Unplug size={16} /> Disconnect
              </button>
            ) : (
              <button
                className="btn btn-primary btn-l"
                disabled={device.status === 'connecting'}
                onClick={() => void trainer.connect()}
              >
                <Bluetooth size={18} />
                {device.status === 'connecting'
                  ? 'Waiting for the trainer…'
                  : 'Pair KICKR via Bluetooth'}
              </button>
            )}
            {!connected && device.status !== 'connecting' && device.canReconnect && (
              <button className="btn" onClick={() => void trainer.connect('reconnect')}>
                Reconnect KICKR
              </button>
            )}
          </div>
          <div className="kv">
            <span>Trainer control</span>
            <span>
              {canControl ? (
                'On · rides you start'
              ) : (
                <button className="link" onClick={onOpenSettings}>
                  Off · turn on in Settings
                </button>
              )}
            </span>
          </div>
          <div className="kv">
            <span>ERG · SIM</span>
            <span>
              {device.features
                ? `${device.features.erg ? 'ERG' : 'no ERG'} · ${device.features.simulation ? 'SIM' : 'no SIM'}`
                : '—'}
            </span>
          </div>
          <div className="kv">
            <span>Power range</span>
            <span>
              {device.range
                ? `${device.range.min}–${device.range.max} W · ${device.range.increment} W steps`
                : '—'}
            </span>
          </div>
        </section>
        <section className="card">
          <h2>Live readings</h2>
          <div className="big-readings">
            <Stat value={fresh(t.powerAt) ? (t.power ?? '—') : '—'} unit="W" label="power" />
            <Stat
              value={fresh(t.cadenceAt) ? (t.cadence ?? '—') : '—'}
              unit="rpm"
              label="cadence"
            />
            <Stat
              value={fresh(t.speedAt) ? (t.speed?.toFixed(1) ?? '—') : '—'}
              unit="km/h"
              label="trainer speed"
            />
          </div>
          <p className="fine">
            Straight from the trainer. Missing or stale values stay blank; nothing is simulated
            here. Ride speed in BikeSIM comes from your power and the road, not this number.
          </p>
        </section>
      </div>
      <details className="card">
        <summary>Manual trainer check</summary>
        <ControlCheck
          canControl={canControl}
          registerStop={registerStop}
          onActiveChange={setChecking}
        />
      </details>
      <details className="card">
        <summary>Connection log</summary>
        <div className="row">
          <button
            className="btn btn-s"
            onClick={() =>
              download(
                'bikesim-diagnostics.json',
                JSON.stringify(
                  {
                    ...device,
                    controlAudit: 'Export separately from the manual trainer check',
                  },
                  null,
                  2,
                ),
              )
            }
          >
            <Download size={15} /> Export diagnostics
          </button>
        </div>
        <pre className="log">{device.log.join('\n') || 'Connection events appear here.'}</pre>
        <p className="fine">
          FTMS characteristics: {device.services.join(', ') || 'none discovered yet'}.
        </p>
      </details>
    </main>
  );
}
