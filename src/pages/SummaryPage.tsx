import { useMemo } from 'react';
import { ArrowLeft, Download, RotateCcw } from 'lucide-react';
import type { Session } from '../ride/engine';
import { analyzeSession } from '../ride/analysis';
import { clock, zones } from '../workouts/model';
import { download, sessionCsv } from '../storage/store';
import { RideChart, RouteMap } from '../ui/charts';
import { Stat } from '../ui/kit';
import ActivityExport from '../ui/ActivityExport';

export function sessionLabel(s: Session) {
  const kind = s.route ? 'Road ride' : `${s.workout.category} workout`;
  const how =
    s.source === 'demo'
      ? 'demo · simulated rider'
      : s.trainerControl === 'sim'
        ? 'trainer set the slope'
        : s.trainerControl === 'erg'
          ? 'trainer held the watts'
          : 'live power';
  return `${kind} · ${how}`;
}

export default function SummaryPage({
  session,
  onBack,
  onRideAgain,
}: {
  session: Session;
  onBack: () => void;
  onRideAgain?: () => void;
}) {
  const a = useMemo(() => analyzeSession(session), [session]);
  const done = session.status === 'completed';
  const zoneTotal = a.zoneSeconds?.reduce((n, s) => n + s, 0) ?? 0;
  return (
    <main className="page">
      <button className="btn btn-ghost btn-s" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            {done
              ? 'Ride complete'
              : session.status === 'interrupted'
                ? 'Recovered ride'
                : 'Ride saved'}{' '}
            · {sessionLabel(session)}
          </span>
          <h1 className="page-title">{session.workout.name}</h1>
          <p className="muted">
            {new Date(session.startedAt).toLocaleString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
        </div>
        {onRideAgain && (
          <button className="btn" onClick={onRideAgain}>
            <RotateCcw size={16} /> Ride it again
          </button>
        )}
      </div>
      {session.source === 'demo' && (
        <p className="notice">Demo ride: these numbers come from the simulated rider.</p>
      )}
      <div className="stat-grid">
        <Stat className="stat-tile" value={clock(a.seconds)} label="riding time" />
        <Stat className="stat-tile" value={a.km.toFixed(2)} unit="km" label="virtual distance" />
        <Stat
          className="stat-tile"
          value={Math.round(a.averagePower)}
          unit="W"
          label="average power"
        />
        {a.stress !== undefined ? (
          <Stat
            className="stat-tile"
            value={Math.round(a.stress)}
            label={`TSS · IF ${a.intensity!.toFixed(2)}`}
          />
        ) : (
          <Stat
            className="stat-tile"
            value={Math.round(a.normalizedPower)}
            unit="W"
            label="normalized power"
          />
        )}
        {a.climbed !== undefined ? (
          <Stat className="stat-tile" value={Math.round(a.climbed)} unit="m" label="climbed" />
        ) : (
          <Stat
            className="stat-tile"
            value={a.averageCadence ? Math.round(a.averageCadence) : '—'}
            unit="rpm"
            label="average cadence"
          />
        )}
        <Stat
          className="stat-tile"
          value={a.averageSpeed.toFixed(1)}
          unit="km/h"
          label="average speed"
        />
        <Stat className="stat-tile" value={Math.round(a.work)} unit="kJ" label="work done" />
      </div>
      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>{session.route ? 'Power over the road' : 'Power and target'}</h2>
            <div className="chart-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} /> Power
              </span>
              <span>
                <i style={{ background: session.route ? '#2d3540' : '#8b93a0' }} />
                {session.route ? 'Elevation' : 'Target'}
              </span>
            </div>
          </div>
          <RideChart session={session} />
          <div className="stats">
            <Stat value={Math.round(a.maxPower)} unit="W" label="max power" />
            <Stat value={Math.round(a.normalizedPower)} unit="W" label="normalized" />
            <Stat value={a.maxSpeed.toFixed(1)} unit="km/h" label="top speed" />
            {a.averageCadence !== undefined && (
              <Stat value={Math.round(a.averageCadence)} unit="rpm" label="avg cadence" />
            )}
          </div>
          {a.zoneSeconds && zoneTotal > 0 && (
            <div className="zone-bars" aria-label="Time in power zones">
              {zones.map((z, i) => (
                <div className="zone-bar" key={z.id}>
                  <span>{z.id}</span>
                  <div>
                    <span
                      style={{
                        width: `${(a.zoneSeconds![i] / zoneTotal) * 100}%`,
                        background: z.color,
                      }}
                    />
                  </div>
                  <span>{clock(a.zoneSeconds![i])}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="stack">
          {session.route?.path && (
            <section className="card">
              <h2>The road</h2>
              <div style={{ height: 220 }}>
                <RouteMap route={session.route} meters={session.distance * 1000} />
              </div>
              {session.route.attribution && (
                <p className="attribution">{session.route.attribution}</p>
              )}
            </section>
          )}
          <ActivityExport key={session.id} session={session} />
          <section className="card">
            <h2>Your data</h2>
            <div className="row">
              <button
                className="btn btn-s"
                onClick={() =>
                  download(`bikesim-${session.id}.json`, JSON.stringify(session, null, 2))
                }
              >
                <Download size={15} /> JSON
              </button>
              <button
                className="btn btn-s"
                onClick={() =>
                  download(`bikesim-${session.id}.csv`, sessionCsv(session), 'text/csv')
                }
              >
                <Download size={15} /> CSV
              </button>
            </div>
            {session.events.length > 0 && (
              <details>
                <summary>Ride log ({session.events.length})</summary>
                <div className="event-list">
                  {session.events.map((e, i) => (
                    <span key={i}>
                      {clock(e.elapsed)} · {e.message}
                    </span>
                  ))}
                </div>
              </details>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
