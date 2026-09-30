import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { type Workout, validateWorkout, totalSeconds, workoutLoad } from '../workouts/model';
import { WorkoutProfile } from './charts';

const fields = [
  { key: 'seconds', label: 'Seconds', min: 5, max: 18000 },
  { key: 'from', label: 'Start %', min: 20, max: 160 },
  { key: 'to', label: 'End %', min: 20, max: 160 },
  { key: 'cadence', label: 'Cadence', min: 40, max: 130 },
] as const;

export default function WorkoutEditor({
  workout,
  onSave,
  onClose,
}: {
  workout: Workout;
  onSave: (w: Workout) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Workout>(() => ({
    ...structuredClone(workout),
    id: crypto.randomUUID(),
    name: workout.custom ? workout.name : `${workout.name} · my version`,
    custom: true,
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  const load = workoutLoad(draft);
  const edit = (i: number, patch: Partial<Workout['blocks'][number]>) =>
    setDraft({
      ...draft,
      blocks: draft.blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)),
    });
  return (
    <dialog ref={dialog} className="sheet" onCancel={onClose} aria-labelledby="editor-title">
      <form
        className="sheet-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            validateWorkout(draft);
            setSaving(true);
            await onSave(draft);
          } catch (err) {
            setError((err as Error).message);
            setSaving(false);
          }
        }}
      >
        <div className="sheet-head">
          <div>
            <span className="eyebrow">Make it yours</span>
            <h2 id="editor-title" style={{ fontSize: 34 }}>
              Customize workout
            </h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close editor" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          Workout name
          <input
            value={draft.name}
            maxLength={80}
            required
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <WorkoutProfile workout={draft} large />
        <p className="muted">
          {Math.round(totalSeconds(draft) / 60)} min · IF {load.intensity.toFixed(2)} · TSS{' '}
          {load.stress}. Targets are % of your FTP; the original stays in the library.
        </p>
        <div className="editor-rows">
          <div className="editor-row labels" aria-hidden="true">
            <span>Interval</span>
            {fields.map((f) => (
              <span key={f.key}>{f.label}</span>
            ))}
            <span />
          </div>
          {draft.blocks.map((b, i) => (
            <div className="editor-row" key={i}>
              <input
                aria-label={`Interval ${i + 1} name`}
                value={b.name}
                onChange={(e) => edit(i, { name: e.target.value })}
              />
              {fields.map((f) => {
                const percent = f.key === 'from' || f.key === 'to';
                return (
                  <input
                    key={f.key}
                    aria-label={`Interval ${i + 1} ${f.key}`}
                    type="number"
                    min={f.min}
                    max={f.max}
                    step={1}
                    required
                    value={percent ? Math.round(b[f.key] * 100) : b[f.key]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      edit(i, { [f.key]: percent ? n / 100 : n });
                    }}
                  />
                );
              })}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Delete interval ${i + 1}`}
                disabled={draft.blocks.length === 1}
                onClick={() =>
                  setDraft({ ...draft, blocks: draft.blocks.filter((_, j) => j !== i) })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-s"
            onClick={() =>
              setDraft({
                ...draft,
                blocks: [
                  ...draft.blocks,
                  {
                    name: 'Steady effort',
                    seconds: 120,
                    from: 0.65,
                    to: 0.65,
                    cadence: 85,
                    grade: 1,
                    cue: 'Settle into your rhythm.',
                  },
                ],
              })
            }
          >
            <Plus size={16} /> Add interval
          </button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save custom workout'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
