import { useRef, useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { backup, download, restoreBackup, type Settings as RiderSettings } from '../storage/store';
export default function Settings({
  settings,
  onSave,
  onImport,
}: {
  settings: RiderSettings;
  onSave: (s: RiderSettings) => Promise<void>;
  onImport: () => Promise<void>;
}) {
  const [ftp, setFtp] = useState(settings.ftp?.toString() ?? ''),
    [mass, setMass] = useState(settings.mass.toString()),
    [quality, setQuality] = useState(settings.quality);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <main className="content-page">
      <div className="eyebrow">SET UP YOUR RIDE</div>
      <h1>A good fit.</h1>
      <p>Your settings stay on this computer.</p>
      <div className="two-columns">
        <form
          className="panel settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const next = { ftp: ftp.trim() ? Number(ftp) : null, mass: Number(mass), quality };
              if (
                (next.ftp !== null &&
                  (!Number.isFinite(next.ftp) || next.ftp < 50 || next.ftp > 600)) ||
                !Number.isFinite(next.mass) ||
                next.mass < 35 ||
                next.mass > 200
              )
                throw new Error('Check the FTP and weight ranges.');
              await onSave(next);
              setMessage('Settings saved.');
            } catch (err) {
              setMessage((err as Error).message);
            }
          }}
        >
          <h2>Rider & display</h2>
          <label>
            FTP (watts)
            <input
              aria-label="FTP watts"
              type="number"
              min={50}
              max={600}
              step={1}
              placeholder="Enter your known FTP"
              value={ftp}
              onChange={(e) => setFtp(e.target.value)}
            />
            <small>
              Leave blank if unknown. Demo mode uses a labeled 200 W example. Live workouts require
              your own value.
            </small>
          </label>
          <label>
            Rider weight (kg)
            <input
              aria-label="Rider weight kg"
              type="number"
              min={35}
              max={200}
              step={0.1}
              required
              value={mass}
              onChange={(e) => setMass(e.target.value)}
            />
            <small>
              Used only for estimated virtual speed. 75 kg is the initial simulation assumption;
              bike weight is 9 kg.
            </small>
          </label>
          <label>
            Graphics quality
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as RiderSettings['quality'])}
            >
              <option value="high">High · more roadside detail</option>
              <option value="low">Low · lighter rendering</option>
            </select>
          </label>
          <button className="primary">
            <Save size={16} /> Save settings
          </button>
        </form>
        <section className="panel">
          <h2>Your data, with you.</h2>
          <p>
            Back up your settings, custom workouts, and ride history. Browser storage can be
            cleared; a downloaded backup gives you a copy to keep.
          </p>
          <button
            className="secondary full"
            onClick={() =>
              void backup()
                .then((b) => download('bikesim-backup.json', JSON.stringify(b)))
                .catch(() => setMessage('Could not read local storage.'))
            }
          >
            <Download size={17} /> Download backup
          </button>
          <button className="secondary full" onClick={() => input.current?.click()}>
            <Upload size={17} /> Import BikeSIM backup
          </button>
          <input
            hidden
            ref={input}
            type="file"
            accept="application/json,.json"
            aria-label="Import backup file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                if (file.size > 50_000_000) throw new Error('Backups must be smaller than 50 MB.');
                await restoreBackup(JSON.parse(await file.text()));
                await onImport();
                setMessage(
                  'Backup imported. Matching record IDs were replaced; other rides were kept.',
                );
              } catch (err) {
                setMessage((err as Error).message);
              }
              e.target.value = '';
            }}
          />
          <p className="fine-print">Import merges records and replaces matching IDs.</p>
          <hr />
          <h3>Trainer control</h3>
          <p>
            This build reads Bluetooth telemetry. Automatic ERG and slope commands stay disabled
            until supervised hardware validation. The demo models workout targets without
            controlling your KICKR.
          </p>
        </section>
      </div>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
