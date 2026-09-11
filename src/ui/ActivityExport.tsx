import { useState } from 'react';
import { Download, ArrowUpRight } from 'lucide-react';
import type { Session } from '../ride/engine';
import { activityFileName, activityTimeline, fitExportIssue } from '../export/activity';
import { download } from '../storage/store';

export default function ActivityExport({ session }: { session: Session }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const issue = fitExportIssue(session);
  return (
    <section className="panel activity-export" aria-label="Strava file export">
      <div className="eyebrow">TAKE YOUR RIDE WITH YOU</div>
      <h2>Upload your ride to Strava.</h2>
      <p>
        Download the FIT activity file, then select it on Strava’s file upload page. It includes
        recorded time, power, available cadence, and virtual speed and distance.
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
