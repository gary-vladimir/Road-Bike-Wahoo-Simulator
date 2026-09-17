import { useId, useState } from 'react';
import { Download, ArrowUpRight } from 'lucide-react';
import type { Session } from '../ride/engine';
import { activityFileName, activityTimeline, fitExportIssue } from '../export/activity';
import { download } from '../storage/store';
import { activityPresentation } from '../export/presentation';

export default function ActivityExport({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const issue = fitExportIssue(session);
  const descriptionId = useId();
  const presentation = activityPresentation(session);
  const copy = async (value: string, label: string) => {
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied. Paste it into Strava’s upload form.`);
    } catch {
      setError('Clipboard is unavailable. Select and copy the text below manually.');
    }
  };
  return (
    <section className="panel activity-export" aria-label="Strava file export">
      <div className="eyebrow">TAKE YOUR RIDE WITH YOU</div>
      <h2>Upload your ride to Strava.</h2>
      <p>
        Download the FIT activity file, then select it on Strava’s file upload page. It includes
        recorded time, power, available cadence, and virtual speed and distance. The activity is
        marked as indoor cycling.
      </p>
      {session.source === 'demo' && (
        <p className="notice">
          Demo ride: this file contains simulated exercise data, not a real training activity. Its
          filename is marked DEMO.
        </p>
      )}
      <div className="summary-actions">
        <button
          className="primary"
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
              setMessage(
                'FIT download ready. Choose this file in Strava, review the activity, then save it.',
              );
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
          className="secondary"
          href="https://www.strava.com/upload/select"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Strava file upload <ArrowUpRight size={17} />
        </a>
      </div>
      <details className="export-presentation">
        <summary>Title and description for Strava</summary>
        <p className="fine-print">
          Strava may ignore titles and descriptions inside FIT files. Copy these into its upload
          form if needed. The FIT also stores the title and a short workout description.
        </p>
        <label>
          Activity title
          <input readOnly value={presentation.title} onFocus={(e) => e.target.select()} />
        </label>
        <button className="secondary" onClick={() => void copy(presentation.title, 'Title')}>
          Copy title
        </button>
        <label htmlFor={descriptionId}>Activity description</label>
        <textarea
          id={descriptionId}
          readOnly
          rows={7}
          value={presentation.description}
          onFocus={(e) => e.target.select()}
        />
        <button
          className="secondary"
          onClick={() => void copy(presentation.description, 'Description')}
        >
          Copy description
        </button>
      </details>
      {issue && <p className="notice">{issue}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <p className="fine-print">
        The file is created on this computer. You choose when to upload it. Distance and speed are
        simulated; no outdoor GPS route or unmeasured heart rate is included.
      </p>
      {activityTimeline(session).legacy && (
        <p className="fine-print">
          Older ride: exact pause durations were not recorded. The FIT file uses the saved start
          date and active riding time.
        </p>
      )}
      {session.status === 'interrupted' && (
        <p className="fine-print">
          Recovered ride: the file contains data up to the last saved checkpoint.
        </p>
      )}
    </section>
  );
}
