import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { type Workout, validateWorkout, totalSeconds } from '../workouts/model';
import Profile from './Profile';
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
    name: `${workout.name} — my version`,
    custom: true,
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor-dialog"
      onCancel={onClose}
      aria-labelledby="editor-title"
    >
      <form
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
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2 id="editor-title">Customize workout</h2>
          </div>
          <button type="button" aria-label="Close editor" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Workout name
          <input
            value={draft.name}
            maxLength={80}
            required
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <Profile workout={draft} large />
        <p>
          {Math.round(totalSeconds(draft) / 60)} minutes · Targets use your FTP. Original preset
          stays available.
        </p>
        <div className="editor-table">
          <div className="editor-row editor-labels">
            <span>Interval</span>
            <span>Seconds</span>
            <span>Start %</span>
            <span>End %</span>
            <span>Cadence</span>
            <span />
          </div>
          {draft.blocks.map((b, i) => (
            <div className="editor-row" key={i}>
              <input
                aria-label={`Interval ${i + 1} name`}
                value={b.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    blocks: draft.blocks.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  })
                }
              />
              {(['seconds', 'from', 'to', 'cadence'] as const).map((key) => (
                <input
                  key={key}
                  aria-label={`Interval ${i + 1} ${key}`}
                  type="number"
                  min={key === 'seconds' ? 5 : key === 'cadence' ? 40 : 20}
                  max={key === 'seconds' ? 18000 : key === 'cadence' ? 130 : 120}
                  step={1}
                  required
                  value={key === 'from' || key === 'to' ? Math.round(b[key] * 100) : b[key]}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setDraft({
                      ...draft,
                      blocks: draft.blocks.map((x, j) =>
                        j === i ? { ...x, [key]: key === 'from' || key === 'to' ? n / 100 : n } : x,
                      ),
                    });
                  }}
                />
              ))}
              <button
                type="button"
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
        <button
          type="button"
          className="secondary"
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
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={saving}>
            <Save size={16} /> {saving ? 'Saving…' : 'Save custom workout'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
