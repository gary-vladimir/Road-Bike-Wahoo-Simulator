import { Download, Trash2, ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import type { Session } from '../ride/engine';
import { clock } from '../workouts/model';
import { download, sessionCsv } from '../storage/store';
import ActivityExport from './ActivityExport';
export function Summary({ session, onBack }: { session: Session; onBack: () => void }) {
  const samples = session.samples,
    mean = samples.length
      ? Math.round(samples.reduce((n, s) => n + s.power, 0) / samples.length)
      : 0;
  return (
    <main className="content-page summary-page">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={17} /> {session.route ? 'Back to roads' : 'Back to workouts'}
      </button>
      <div className="eyebrow">
        {session.source === 'demo'
          ? 'DEMO SESSION · SIMULATED DATA'
          : 'LIVE POWER SESSION · READ-ONLY'}
      </div>
      <h1>{session.status === 'completed' ? 'A ride well spent.' : 'Your ride, recorded.'}</h1>
      <p>
        {session.workout.name} · {new Date(session.startedAt).toLocaleString()} · {session.status}
      </p>
      <p>
        {session.route
          ? 'SIM terrain preview · free pacing · no resistance commands'
          : 'ERG workout preview · guided power targets'}
      </p>
      <div className="summary-stats">
        <div>
          <strong>{clock(session.elapsed)}</strong>
          <span>active ride time</span>
        </div>
        <div>
          <strong>
            {session.distance.toFixed(2)} <small>km</small>
          </strong>
          <span>virtual distance</span>
        </div>
        <div>
          <strong>
            {mean} <small>W</small>
          </strong>
          <span>sample average power</span>
        </div>
        <div>
          <strong>{samples.length}</strong>
          <span>recorded samples</span>
        </div>
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>Power through your ride</h2>
          <span>Recorded power · watts</span>
        </div>
        <PowerChart session={session} />
      </section>
      <ActivityExport key={session.id} session={session} />
      <div className="summary-actions">
        <button
          className="secondary"
          onClick={() => download(`bikesim-${session.id}.json`, JSON.stringify(session, null, 2))}
        >
          <Download size={17} /> Export session JSON
        </button>
        <button
          className="secondary"
          onClick={() => download(`bikesim-${session.id}.csv`, sessionCsv(session), 'text/csv')}
        >
          <Download size={17} /> Export CSV
        </button>
      </div>
      <p>
        Saved locally. JSON preserves the complete BikeSIM session; CSV provides the recorded
        samples.
      </p>
      {session.events.length > 0 && (
        <details className="panel">
          <summary>Session events ({session.events.length})</summary>
          {session.events.map((e, i) => (
            <p key={i}>
              {clock(e.elapsed)} · {e.message}
            </p>
          ))}
        </details>
      )}
    </main>
  );
}
function PowerChart({ session }: { session: Session }) {
  const samples = session.samples.filter(
    (_, i, a) => i % Math.max(1, Math.ceil(a.length / 500)) === 0,
  );
  if (!samples.length)
    return (
      <div className="empty-chart">No power samples were recorded before this ride ended.</div>
    );
  const max = Math.max(100, ...samples.map((p) => Math.max(p.power, p.target)));
  const points = (key: 'power' | 'target') =>
    samples
      .map(
        (p) => `${(p.elapsed / Math.max(1, session.elapsed)) * 1000},${180 - (p[key] / max) * 170}`,
      )
      .join(' ');
  return (
    <svg
      className="power-chart"
      viewBox="0 0 1000 190"
      role="img"
      aria-label="Recorded power and target over elapsed ride time"
    >
      <line x1="0" x2="1000" y1="180" y2="180" stroke="#465343" />
      {!session.route && (
        <polyline
          points={points('target')}
          fill="none"
          stroke="#80917d"
          strokeDasharray="5 5"
          strokeWidth="2"
        />
      )}
      <polyline points={points('power')} fill="none" stroke="#d9ff69" strokeWidth="2.5" />
    </svg>
  );
}
export default function History({
  sessions,
  onOpen,
  onDelete,
}: {
  sessions: Session[];
  onOpen: (s: Session) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <main className="content-page">
      <div className="eyebrow">EVERY RIDE COUNTS</div>
      <h1>Your ride history.</h1>
      <p>Stored on this computer. Demo rides are marked separately.</p>
      {sessions.length === 0 ? (
        <section className="empty-state">
          <h2>Your first ride starts here.</h2>
          <p>Complete or finish a workout and it will appear here.</p>
        </section>
      ) : (
        <div className="history-list">
          {sessions.map((s) => (
            <article className="history-item" key={s.id}>
              <button className="history-main" onClick={() => onOpen(s)}>
                <span className="eyebrow">
                  {new Date(s.startedAt).toLocaleDateString()} ·{' '}
                  {s.source === 'demo' ? 'DEMO' : 'LIVE POWER'} · {s.route ? 'SIM' : 'ERG'} ·{' '}
                  {s.status}
                </span>
                <h3>{s.workout.name}</h3>
                <span>
                  {clock(s.elapsed)} · {s.distance.toFixed(2)} virtual km <ArrowUpRight size={16} />
                </span>
              </button>
              {confirm === s.id ? (
                <div>
                  <button
                    className="stop-button"
                    onClick={() => void onDelete(s.id).then(() => setConfirm(null))}
                  >
                    Delete permanently
                  </button>
                  <button className="secondary" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="icon-only"
                  aria-label={`Delete ${s.workout.name} session`}
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
