import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bluetooth, Cable, Download, ShieldCheck, Unplug } from 'lucide-react';
import { trainer } from '../trainer/bluetooth';
import { download } from '../storage/store';
import PowerPilot from './PowerPilot';
export default function Diagnostics() {
  const pilotAvailable = import.meta.env.VITE_TRAINER_CONTROL === 'pilot';
  const stopTest = useRef<(() => Promise<void>) | null>(null);
  const registerStop = useCallback((stop: (() => Promise<void>) | null) => {
    stopTest.current = stop;
  }, []);
  const [pilotActive, setPilotActive] = useState(false);
  const device = useSyncExternalStore(trainer.subscribe, trainer.getSnapshot);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const fresh = device.telemetry.powerAt !== undefined && now - device.telemetry.powerAt < 3000;
  return (
    <main className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR CONNECTION</div>
          <h1>Meet your trainer.</h1>
          <p>Read live metrics from your KICKR CORE 2.</p>
        </div>
        <span className="pill">
          <ShieldCheck size={15} /> {pilotAvailable ? 'Manual control test available' : 'Read-only'}
        </span>
      </div>
      <div className="two-columns">
        <section className="panel">
          <Bluetooth size={32} className="lime" />
          <h2>{device.name}</h2>
          <p role="status">
            {pilotActive
              ? 'Supervised test active. See test status and Stop controls below.'
              : device.message}
          </p>
          <div className="connection-facts">
            <span>
              Status
              <strong>
                {device.status === 'connected'
                  ? fresh
                    ? 'Live power received'
                    : 'Connected · waiting for power'
                  : device.status}
              </strong>
            </span>
            <span>
              Trainer control
              <strong>{pilotAvailable ? 'Explicit test start required' : 'Disabled'}</strong>
            </span>
            <span>
              Transport<strong>Bluetooth · FTMS</strong>
            </span>
          </div>
          {device.status === 'connected' ? (
            <button
              className="secondary"
              onClick={async () => {
                await stopTest.current?.();
                trainer.disconnect();
              }}
            >
              <Unplug size={16} /> Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={device.status === 'connecting'}
              onClick={() => void trainer.connect()}
            >
              <Bluetooth size={17} />{' '}
              {device.status === 'connecting' ? 'Waiting for trainer…' : 'Pair KICKR via Bluetooth'}
            </button>
          )}
          <p className="fine-print">
            Use Chrome on this Mac. Choose your trainer in the browser window. Pairing does not
            change resistance.
          </p>
          {device.status !== 'connected' &&
            device.status !== 'connecting' &&
            device.canReconnect && (
              <button className="secondary" onClick={() => void trainer.connect('reconnect')}>
                Reconnect KICKR
              </button>
            )}
        </section>
        <section className="panel">
          <h2>Live readings</h2>
          <div className="diagnostic-metrics">
            <div>
              <strong>{fresh ? device.telemetry.power : '—'}</strong>
              <span>watts</span>
            </div>
            <div>
              <strong>
                {device.telemetry.cadenceAt !== undefined && now - device.telemetry.cadenceAt < 3000
                  ? device.telemetry.cadence
                  : '—'}
              </strong>
              <span>rpm</span>
            </div>
            <div>
              <strong>
                {device.telemetry.speedAt !== undefined && now - device.telemetry.speedAt < 3000
                  ? device.telemetry.speed?.toFixed(1)
                  : '—'}
              </strong>
              <span>trainer km/h</span>
            </div>
          </div>
          <p>
            Pedal gently after pairing. Missing or stale fields stay blank. No simulated readings
            appear here.
          </p>
          <div className="connection-facts">
            <span>
              ERG advertised
              <strong>
                {device.features ? (device.features.erg ? 'Yes · not validated' : 'No') : 'Unknown'}
              </strong>
            </span>
            <span>
              SIM advertised
              <strong>
                {device.features
                  ? device.features.simulation
                    ? 'Yes · not validated'
                    : 'No'
                  : 'Unknown'}
              </strong>
            </span>
            <span>
              Power range
              <strong>
                {device.range
                  ? `${device.range.min}–${device.range.max} W · ${device.range.increment} W steps`
                  : 'Unknown'}
              </strong>
            </span>
          </div>
        </section>
      </div>
      {pilotAvailable && <PowerPilot registerStop={registerStop} onActiveChange={setPilotActive} />}
      <section className="panel diagnostics-log">
        <div className="section-title">
          <h2>Connection log</h2>
          <button
            className="secondary"
            onClick={() =>
              download(
                'bikesim-diagnostics.json',
                JSON.stringify(
                  {
                    ...device,
                    telemetry: device.telemetry,
                    telemetryAdapterWrites: 0,
                    controlAudit: pilotAvailable
                      ? 'Export separately from the supervised test panel'
                      : 'Control disabled',
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
        {device.log.length ? (
          <pre>{device.log.join('\n')}</pre>
        ) : (
          <p>Connection events will appear here when you pair.</p>
        )}
        <details>
          <summary>Discovered FTMS characteristics ({device.services.length})</summary>
          <pre>{device.services.join('\n') || 'No device discovery yet.'}</pre>
        </details>
      </section>
      <section className="inline-note">
        <Cable size={21} />
        <div>
          <strong>Wi-Fi is a future transport option</strong>
          <p>
            Bluetooth is the first integration. Wi-Fi discovery and control are not implemented in
            this build.
          </p>
        </div>
      </section>
    </main>
  );
}
