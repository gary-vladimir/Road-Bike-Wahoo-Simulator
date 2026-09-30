import { useRef, useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { backup, download, restoreBackup, type Settings } from '../storage/store';
import { stockWheel, nominalCircumference, validateWheel, wheelLabel } from '../ride/bike';
import { ridingPositions, type RidingPosition } from '../ride/physics';

export default function SettingsPage({
  settings,
  onSave,
  onImport,
  onFtpTest,
}: {
  settings: Settings;
  onSave: (s: Settings) => Promise<void>;
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
  const save = async () => {
    const next: Settings = {
      ...settings,
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
      (next.ftp !== null && (!Number.isFinite(next.ftp) || next.ftp < 50 || next.ftp > 600)) ||
      !Number.isFinite(next.mass) ||
      next.mass < 35 ||
      next.mass > 200 ||
      !Number.isFinite(next.bikeMass) ||
      next.bikeMass! < 4 ||
      next.bikeMass! > 30
    )
      throw new Error('Check the ranges: FTP 50–600 W, rider 35–200 kg, bike 4–30 kg.');
    validateWheel(wheel);
    await onSave(next);
  };
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Set up your ride</span>
          <h1 className="page-title">Settings</h1>
          <p className="lede">Everything stays on this computer.</p>
        </div>
      </div>
      <form
        className="split"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await save();
            setMessage('Settings saved.');
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        <div className="stack">
          <section className="card">
            <h2>Rider</h2>
            <div className="form-grid">
              <label className="field">
                FTP (watts)
                <input
                  aria-label="FTP watts"
                  type="number"
                  inputMode="numeric"
                  min={50}
                  max={600}
                  step={1}
                  placeholder="Unknown"
                  value={ftp}
                  onChange={(e) => setFtp(e.target.value)}
                />
                <small>Sets every workout target. Leave blank and take the ramp test.</small>
              </label>
              <label className="field">
                Rider weight (kg)
                <input
                  aria-label="Rider weight kg"
                  type="number"
                  inputMode="decimal"
                  min={35}
                  max={200}
                  step={0.1}
                  required
                  value={mass}
                  onChange={(e) => setMass(e.target.value)}
                />
                <small>Gravity, climbing and rolling resistance.</small>
              </label>
            </div>
            <div className="row">
              <button type="button" className="btn btn-s" onClick={onFtpTest}>
                Take the ramp test
              </button>
            </div>
          </section>
          <section className="card">
            <h2>Bike</h2>
            <div className="form-grid">
              <label className="field">
                Bike weight (kg)
                <input
                  aria-label="Bike weight kg"
                  type="number"
                  inputMode="decimal"
                  min={4}
                  max={30}
                  step={0.1}
                  required
                  value={bikeMass}
                  onChange={(e) => setBikeMass(e.target.value)}
                />
                <small>9 kg is an estimate for the Giant Contend AR 1.</small>
              </label>
              <label className="field">
                Riding position
                <select
                  aria-label="Riding position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value as RidingPosition)}
                >
                  {Object.entries(ridingPositions).map(([id, p]) => (
                    <option key={id} value={id}>
                      {p.label} · {p.hint}
                    </option>
                  ))}
                </select>
                <small>
                  Aerodynamic drag (CdA {ridingPositions[position].cda.toFixed(2)} m²). Oaxaca’s
                  ~1,550 m altitude means thinner air than at sea level.
                </small>
              </label>
              <label className="field">
                Wheel
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
              <label className="field">
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
              <label className="field span-2">
                Wheel circumference (mm) · {wheelLabel(wheel)}
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
                  Stock 700×32C tubeless: 2155 mm is a nominal estimate; a measured rollout is more
                  accurate. It does not change the Wahoo app’s profile.
                </small>
              </label>
            </div>
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <h2>Trainer</h2>
            <label className="switch">
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
                <span className="hint">
                  Roads follow the terrain (SIM) and workouts hold your watts (ERG). The load only
                  changes during rides you start, and pausing always eases it.
                </span>
              </span>
            </label>
            <ul className="tips">
              <li>
                In the Wahoo app, set rider weight to {mass || settings.mass} kg and the wheel to{' '}
                {wheelLabel(wheel)}: the KICKR uses them in SIM.
              </li>
              <li>Close Zwift, the Wahoo app, or anything else that controls the trainer.</li>
              <li>Space or Esc pauses a ride and eases the trainer to a light load.</li>
            </ul>
            <label className="field">
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
                How much of the road’s slope you feel. 100% is the real road; 50% makes a 10% climb
                feel like 5%. The screen and your virtual speed always use the real grade.
              </small>
            </label>
          </section>
          <section className="card">
            <h2>Display</h2>
            <label className="field">
              Graphics quality
              <select
                aria-label="Graphics quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as Settings['quality'])}
              >
                <option value="high">High · more roadside detail</option>
                <option value="low">Low · lighter rendering</option>
              </select>
            </label>
          </section>
          <button className="btn btn-primary btn-l">
            <Save size={17} /> Save settings
          </button>
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          <section className="card">
            <h2>Your data</h2>
            <p className="muted">
              Download a backup before clearing browser data. Imports merge rides and replace
              matching ones; they never switch trainer control on.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn btn-s"
                onClick={() =>
                  void backup()
                    .then((b) => download('bikesim-backup.json', JSON.stringify(b)))
                    .catch(() => setMessage('Could not read local storage.'))
                }
              >
                <Download size={15} /> Download backup
              </button>
              <button type="button" className="btn btn-s" onClick={() => input.current?.click()}>
                <Upload size={15} /> Import BikeSIM backup
              </button>
            </div>
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
                  if (file.size > 50_000_000)
                    throw new Error('Backups must be smaller than 50 MB.');
                  await restoreBackup(JSON.parse(await file.text()));
                  await onImport();
                  setMessage('Backup imported.');
                } catch (err) {
                  setMessage((err as Error).message);
                }
                e.target.value = '';
              }}
            />
          </section>
        </div>
      </form>
    </main>
  );
}
