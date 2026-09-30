import { useRef, useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { backup, download, restoreBackup, type Settings as RiderSettings } from '../storage/store';
import { stockWheel, nominalCircumference, validateWheel, wheelLabel } from '../ride/bike';
import { ridingPositions, type RidingPosition } from '../ride/physics';
export default function Settings({
  settings,
  onSave,
  onImport,
  onFtpTest,
}: {
  settings: RiderSettings;
  onSave: (s: RiderSettings) => Promise<void>;
  onImport: () => Promise<void>;
  onFtpTest: () => void;
}) {
  const [ftp, setFtp] = useState(settings.ftp?.toString() ?? ''),
    [mass, setMass] = useState(settings.mass.toString()),
    [bikeMass, setBikeMass] = useState((settings.bikeMass ?? 9).toString()),
    [wheel, setWheel] = useState({ ...(settings.wheel ?? stockWheel) }),
    [quality, setQuality] = useState(settings.quality),
    [position, setPosition] = useState<RidingPosition>(settings.position ?? 'hoods'),
    [trainerControl, setTrainerControl] = useState(settings.trainerControl === true),
    [difficulty, setDifficulty] = useState(settings.difficulty ?? 100);
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
              const next = {
                ftp: ftp.trim() ? Number(ftp) : null,
                mass: Number(mass),
                bikeMass: Number(bikeMass),
                wheel,
                position,
                trainerControl,
                difficulty,
                quality,
              };
              if (
                (next.ftp !== null &&
                  (!Number.isFinite(next.ftp) || next.ftp < 50 || next.ftp > 600)) ||
                !Number.isFinite(next.mass) ||
                next.mass < 35 ||
                next.mass > 200 ||
                !Number.isFinite(next.bikeMass) ||
                next.bikeMass < 4 ||
                next.bikeMass > 30
              )
                throw new Error('Check the FTP and weight ranges.');
              validateWheel(wheel);
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
              FTP estimates your sustainable power and personalizes workout targets. Leave blank if
              unknown and take the guided test. SIM road rides do not require FTP.
            </small>
          </label>
          <button type="button" className="secondary" onClick={onFtpTest}>
            Take an FTP test
          </button>
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
              Used for gravity, acceleration, and rolling resistance. Your confirmed starting weight
              is 70 kg; update it here as it changes.
            </small>
          </label>
          <label>
            Bike weight (kg)
            <input
              aria-label="Bike weight kg"
              type="number"
              min={4}
              max={30}
              step={0.1}
              required
              value={bikeMass}
              onChange={(e) => setBikeMass(e.target.value)}
            />
            <small>
              9 kg is an estimate, not a measured specification for your bike. Used for virtual
              physics only.
            </small>
          </label>
          <label>
            Riding position
            <select
              aria-label="Riding position"
              value={position}
              onChange={(e) => setPosition(e.target.value as RidingPosition)}
            >
              {Object.entries(ridingPositions).map(([id, p]) => (
                <option key={id} value={id}>
                  {p.label} · {p.hint} · CdA {p.cda.toFixed(2)} m²
                </option>
              ))}
            </select>
            <small>
              Sets aerodynamic drag for virtual speed and SIM trainer load. Oaxaca’s ~1,550 m
              altitude is included: thinner air means less drag than at sea level.
            </small>
          </label>
          <fieldset className="wheel-settings">
            <legend>Wheel & tire · {wheelLabel(wheel)}</legend>
            <p>Default: your stock Giant Contend AR tubeless setup, 700×32C (32-622).</p>
            <label>
              Wheel diameter
              <select
                aria-label="Wheel diameter"
                value={wheel.beadSeatMm}
                onChange={(e) => {
                  const beadSeatMm = Number(e.target.value);
                  setWheel({
                    ...wheel,
                    beadSeatMm,
                    circumferenceMm: nominalCircumference(beadSeatMm, wheel.tireWidthMm),
                  });
                }}
              >
                <option value={622}>700C · 622 mm rim</option>
                <option value={584}>650B · 584 mm rim</option>
                <option value={559}>26 inch · 559 mm rim</option>
              </select>
            </label>
            <label>
              Tire width (mm)
              <input
                aria-label="Tire width mm"
                type="number"
                min={20}
                max={75}
                step={1}
                required
                value={wheel.tireWidthMm}
                onChange={(e) => {
                  const tireWidthMm = Number(e.target.value);
                  setWheel({
                    ...wheel,
                    tireWidthMm,
                    circumferenceMm: nominalCircumference(wheel.beadSeatMm, tireWidthMm),
                  });
                }}
              />
            </label>
            <label>
              Wheel circumference (mm)
              <input
                aria-label="Wheel circumference mm"
                type="number"
                min={1700}
                max={2500}
                step={1}
                required
                value={wheel.circumferenceMm}
                onChange={(e) => setWheel({ ...wheel, circumferenceMm: Number(e.target.value) })}
              />
              <small>
                2155 mm is a nominal estimate for 700×32C. Enter a measured rollout for greater
                accuracy. Used for virtual wheel rotation; power and road forces determine speed.
                These settings do not rewrite the Wahoo profile.
              </small>
            </label>
          </fieldset>
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
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              aria-label="Let BikeSIM control my KICKR"
              checked={trainerControl}
              onChange={async (e) => {
                const on = e.target.checked;
                setTrainerControl(on);
                try {
                  await onSave({ ...settings, trainerControl: on });
                  setMessage(on ? 'Trainer control is on.' : 'Trainer control is off.');
                } catch {
                  setTrainerControl(!on);
                  setMessage('Could not save the trainer control setting.');
                }
              }}
            />
            <span>
              <strong>Let BikeSIM control my KICKR</strong>
              <small>
                Road rides follow the terrain (SIM) and workouts hold your target watts (ERG). Load
                only changes during rides you start. Pausing always eases to a light load.
              </small>
            </span>
          </label>
          <ul className="tips">
            <li>
              In the Wahoo app, set rider weight to {settings.mass} kg and the wheel to{' '}
              {wheelLabel(settings.wheel ?? stockWheel)}; the trainer uses them for SIM.
            </li>
            <li>Close Zwift, the Wahoo app or anything else that controls the trainer.</li>
            <li>Space or Esc pauses a ride and eases the trainer to a light load.</li>
          </ul>
          <label>
            Trainer difficulty · {difficulty}%
            <input
              type="range"
              aria-label="Trainer difficulty percent"
              min={0}
              max={100}
              step={5}
              value={difficulty}
              onChange={(e) => setDifficulty(Number(e.target.value))}
            />
            <small>
              How much of each road's slope you feel on the trainer. 100% is the real road; 50%
              makes a 10% climb feel like 5%. The screen and virtual speed always use the real
              grade. Save settings to apply.
            </small>
          </label>
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
