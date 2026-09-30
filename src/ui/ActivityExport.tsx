import { useId, useState } from 'react';
import { Download, ArrowUpRight, Copy } from 'lucide-react';
import type { Session } from '../ride/engine';
import { activityFileName, activityTimeline, fitExportIssue } from '../export/activity';
import { download } from '../storage/store';
import { activityPresentation } from '../export/presentation';

export default function ActivityExport({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const issue = fitExportIssue(session);
  const titleId = useId(),
    descriptionId = useId();
  const presentation = activityPresentation(session);
  const copy = async (value: string, label: string) => {
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied. Paste it into Strava’s upload form.`);
    } catch {
      setError('Clipboard is unavailable. Select and copy the text manually.');
    }
  };
  return (
    <section className="card" aria-label="Strava file export">
      <h2>Share on Strava</h2>
      <p className="muted">
        {session.route?.path
          ? `The FIT file carries time, power, cadence, virtual speed and the real ${session.route.name} road with its elevation, marked as a virtual ride so Strava shows the map.`
          : 'The FIT file carries time, power, cadence and virtual speed, marked as an indoor ride.'}{' '}
        Nothing uploads automatically.
      </p>
      {session.source === 'demo' && (
        <p className="notice">Demo ride: the file holds simulated data and is named DEMO.</p>
      )}
      <button
        className="btn btn-primary"
        disabled={busy || !!issue}
        onClick={async () => {
          setBusy(true);
          setError('');
          setMessage('');
          try {
            const { sessionFit } = await import('../export/fit');
            const bytes = sessionFit(session);
            download(
              activityFileName(session),
              Uint8Array.from(bytes).buffer,
              'application/octet-stream',
            );
            setMessage('FIT file downloaded. Choose it on Strava’s upload page, then save.');
          } catch (err) {
            setError(`Could not export FIT: ${(err as Error).message}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={17} />
        {busy ? 'Preparing FIT…' : 'Download FIT for Strava'}
      </button>
      <a
        className="btn"
        href="https://www.strava.com/upload/select"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open Strava file upload <ArrowUpRight size={17} />
      </a>
      <details>
        <summary>Title and description for Strava</summary>
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <label className="field" htmlFor={titleId}>
            Activity title
          </label>
          <input
            id={titleId}
            readOnly
            value={presentation.title}
            onFocus={(e) => e.target.select()}
          />
          <button className="btn btn-s" onClick={() => void copy(presentation.title, 'Title')}>
            <Copy size={15} /> Copy title
          </button>
          <label className="field" htmlFor={descriptionId}>
            Activity description
          </label>
          <textarea
            id={descriptionId}
            readOnly
            rows={6}
            value={presentation.description}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn btn-s"
            onClick={() => void copy(presentation.description, 'Description')}
          >
            <Copy size={15} /> Copy description
          </button>
        </div>
      </details>
      {issue && <p className="notice">{issue}</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {activityTimeline(session).legacy && (
        <p className="fine">
          Older ride: exact pause durations were not recorded, so the file uses the start time and
          active riding time.
        </p>
      )}
      {session.status === 'interrupted' && (
        <p className="fine">Recovered ride: the file holds data up to the last saved moment.</p>
      )}
    </section>
  );
}
