import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Session } from '../ride/engine';
import { analyzeSession } from '../ride/analysis';
import { clock } from '../workouts/model';
import { Stat } from '../ui/kit';
import { sessionLabel } from './SummaryPage';

function totals(sessions: Session[], days: number) {
  const since = Date.now() - days * 86400000;
  const rides = sessions.filter(
    (s) => s.source === 'bluetooth' && Date.parse(s.startedAt) >= since,
  );
  return {
    rides: rides.length,
    seconds: rides.reduce((n, s) => n + s.elapsed, 0),
    km: rides.reduce((n, s) => n + s.distance, 0),
    work: rides.reduce((n, s) => n + analyzeSession(s).work, 0),
  };
}

export default function HistoryPage({
  sessions,
  onOpen,
  onDelete,
}: {
  sessions: Session[];
  onOpen: (s: Session) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const week = useMemo(() => totals(sessions, 7), [sessions]);
  const month = useMemo(() => totals(sessions, 28), [sessions]);
  const power = useMemo(
    () => new Map(sessions.map((s) => [s.id, analyzeSession(s).averagePower])),
    [sessions],
  );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Every ride counts</span>
          <h1 className="page-title">History</h1>
          <p className="lede">Stored on this computer. Demo rides are listed but not counted.</p>
        </div>
      </div>
      <div className="week-strip">
        <Stat className="stat-tile" value={week.rides} label="rides · 7 days" />
        <Stat className="stat-tile" value={clock(week.seconds)} label="riding · 7 days" />
        <Stat
          className="stat-tile"
          value={week.km.toFixed(1)}
          unit="km"
          label="distance · 7 days"
        />
        <Stat className="stat-tile" value={Math.round(week.work)} unit="kJ" label="work · 7 days" />
        <Stat className="stat-tile" value={clock(month.seconds)} label="riding · 28 days" />
      </div>
      {sessions.length === 0 ? (
        <section className="card">
          <h2>Your first ride starts here.</h2>
          <p className="muted">Finish a road or a workout and it will appear here.</p>
        </section>
      ) : (
        <div className="ride-list">
          {sessions.map((s) => (
            <article className="ride-row" key={s.id}>
              <button className="ride-row-main" onClick={() => onOpen(s)}>
                <span className="ride-row-date">
                  {new Date(s.startedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
                <span>
                  <strong>{s.workout.name}</strong>
                  <br />
                  <span className="fine">
                    {sessionLabel(s)}
                    {s.status !== 'completed' ? ` · ${s.status}` : ''}
                  </span>
                </span>
                <Stat value={clock(s.elapsed)} label="time" />
                <Stat value={s.distance.toFixed(1)} unit="km" label="distance" />
                <Stat
                  className="hide-narrow"
                  value={Math.round(power.get(s.id) ?? 0)}
                  unit="W"
                  label="avg power"
                />
              </button>
              {confirm === s.id ? (
                <div className="row">
                  <button
                    className="btn btn-s btn-danger"
                    onClick={() => void onDelete(s.id).then(() => setConfirm(null))}
                  >
                    Delete for good
                  </button>
                  <button className="btn btn-s btn-ghost" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  className="icon-btn"
                  aria-label={`Delete ${s.workout.name} ride`}
                  onClick={() => setConfirm(s.id)}
                >
                  <Trash2 size={17} />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
