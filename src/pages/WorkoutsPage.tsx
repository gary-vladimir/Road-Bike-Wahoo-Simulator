import { useState } from 'react';
import { Gauge, Pencil, Play, Trash2 } from 'lucide-react';
import type { DeviceSnapshot } from '../trainer/bluetooth';
import type { Settings } from '../storage/store';
import { categories, presets, totalSeconds, workoutLoad, type Workout } from '../workouts/model';
import { WorkoutProfile } from '../ui/charts';
import { Segmented, Stat } from '../ui/kit';
import { launchIssue, type RideRequest, type RideSource } from '../app/launch';
import { preferredSource, SourceNote, sourceOptions, type Page } from './RidePage';

const stars = (n?: number) => (n ? '★'.repeat(n) + '☆'.repeat(3 - n) : '');

export default function WorkoutsPage({
  settings,
  device,
  custom,
  selected,
  loaded,
  onSelect,
  onStart,
  onCustomize,
  onDelete,
  onFtpTest,
  onNavigate,
}: {
  settings: Settings;
  device: DeviceSnapshot;
  custom: Workout[];
  selected: Workout;
  loaded: boolean;
  onSelect: (w: Workout) => void;
  onStart: (request: RideRequest) => void;
  onCustomize: (w: Workout) => void;
  onDelete: (w: Workout) => void;
  onFtpTest: () => void;
  onNavigate: (page: Page) => void;
}) {
  const [filter, setFilter] = useState<string>('All');
  const [source, setSource] = useState<RideSource>(() => preferredSource(settings, device));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const all = [...presets, ...custom];
  const present = categories.filter((c) => all.some((w) => w.category === c));
  const shown = all.filter((w) =>
    filter === 'All' ? true : filter === 'Mine' ? w.custom : w.category === filter,
  );
  const options = sourceOptions(settings, 'workout');
  const chosen = options.some((o) => o.value === source) ? source : 'demo';
  const request: RideRequest = { kind: 'workout', workout: selected, source: chosen };
  const issue = launchIssue(request, settings, device);
  const load = workoutLoad(selected);
  const peak = Math.max(...selected.blocks.map((b) => Math.max(b.from, b.to)));
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Structured power · ERG</span>
          <h1 className="page-title">Workouts</h1>
          <p className="lede">
            Pick a session, press start, and the trainer holds every target while the road rises
            with the effort.
          </p>
        </div>
        <div className="card" style={{ minWidth: 300 }}>
          <div className="card-head">
            <h2>{settings.ftp === null ? 'No FTP yet' : `FTP ${settings.ftp} W`}</h2>
            <Gauge size={22} className="muted" aria-hidden="true" />
          </div>
          <p className="fine">
            {settings.ftp === null
              ? 'Targets are a percentage of FTP. A 20–30 minute ramp test finds yours.'
              : 'All targets scale with your FTP. Retest every 4–6 weeks.'}
          </p>
          <button className="btn" disabled={!loaded} onClick={onFtpTest}>
            Take the ramp test
          </button>
        </div>
      </div>
      <div className="filter-row" aria-label="Workout categories">
        {['All', ...present, ...(custom.length ? ['Mine'] : [])].map((f) => (
          <button
            key={f}
            className="filter"
            aria-pressed={f === filter}
            onClick={() => setFilter(f)}
          >
            {f === 'Mine' ? 'My workouts' : f === 'VO2max' ? 'VO₂max' : f}
          </button>
        ))}
      </div>
      <div className="split">
        <div className="workout-grid">
          {shown.map((w) => {
            const l = workoutLoad(w);
            return (
              <button
                key={w.id}
                className="workout-card"
                aria-pressed={w.id === selected.id}
                onClick={() => {
                  onSelect(w);
                  setConfirmDelete(false);
                }}
              >
                <span className="eyebrow">{w.custom ? 'My workout' : w.category}</span>
                <h3>{w.name}</h3>
                <WorkoutProfile workout={w} />
                <span className="meta">
                  <span>
                    {Math.round(totalSeconds(w) / 60)} min · TSS {l.stress}
                  </span>
                  {w.triathlon && (
                    <span aria-label={`Triathlon relevance ${w.triathlon} of 3`}>
                      Tri {stars(w.triathlon)}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <aside className="card detail">
          <span className="eyebrow">{selected.custom ? 'My workout' : selected.category}</span>
          <h2>{selected.name}</h2>
          <p className="muted">{selected.description}</p>
          <WorkoutProfile workout={selected} large />
          <div className="stats">
            <Stat value={Math.round(totalSeconds(selected) / 60)} unit="min" label="duration" />
            <Stat value={Math.round(peak * 100)} unit="%" label="peak FTP" />
            <Stat value={load.intensity.toFixed(2)} label="intensity" />
            <Stat value={load.stress} label="TSS" />
          </div>
          <Segmented label="Ride source" options={options} value={chosen} onChange={setSource} />
          <button
            className="btn btn-primary btn-l"
            disabled={!loaded || !!issue}
            onClick={() => onStart(request)}
          >
            <Play size={18} fill="currentColor" /> Start workout
          </button>
          <SourceNote
            request={request}
            settings={settings}
            device={device}
            onNavigate={onNavigate}
          />
          <div className="row">
            <button className="btn btn-s" onClick={() => onCustomize(selected)}>
              <Pencil size={15} /> {selected.custom ? 'Edit a copy' : 'Customize'}
            </button>
            {selected.custom &&
              (confirmDelete ? (
                <>
                  <button className="btn btn-s btn-danger" onClick={() => onDelete(selected)}>
                    Delete for good
                  </button>
                  <button className="btn btn-s btn-ghost" onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="btn btn-s btn-ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={15} /> Delete
                </button>
              ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
