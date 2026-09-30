import type { Telemetry } from '../trainer/ftms';
import type { SessionSnapshot, TrainerSession } from '../trainer/session';
import { staleTelemetryMs } from '../trainer/session';
import { lastPowerAcknowledgement } from '../trainer/evidence';
import {
  estimateFtp,
  ftpDuration,
  ftpTarget,
  ftpWarmupSeconds,
  type FtpAssessment,
  type FtpProtocol,
  type FtpStartingLoad,
} from './ftp-test';

type Open = (changed: (s: SessionSnapshot) => void) => Promise<TrainerSession>;

/**
 * Guided ramp test. The warm-up clock runs only while the rider pedals; the trainer eases to the
 * starting load during pauses. During the ramp, sustained low cadence means the rider reached
 * their limit, so the test finishes and estimates FTP from the best measured minute.
 */
export class FtpControl {
  phase: 'waiting' | 'running' | 'finishing' | 'finished' = 'waiting';
  snapshot?: SessionSnapshot;
  report: FtpAssessment;
  private session?: TrainerSession;
  private pending?: Promise<void>;
  private ending?: Promise<void>;
  private last?: number;
  constructor(
    protocol: FtpProtocol,
    private open: Open,
    private changed: () => void,
    private now = () => performance.now(),
    startingLoad: FtpStartingLoad = 50,
    private currentTelemetry?: () => Telemetry,
  ) {
    if (![50, 75, 100].includes(startingLoad)) throw new Error('Invalid FTP starting load.');
    this.report = {
      version: 1,
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      protocol,
      startingLoad,
      status: 'in-progress',
      elapsed: 0,
      readings: [],
      reason: '',
      stopConfirmed: false,
    };
  }

  get ramp() {
    return this.report.elapsed >= ftpWarmupSeconds;
  }

  /** Warm-up is paused while the trainer holds the recovery load. */
  get warmupPaused() {
    return this.phase === 'running' && !this.ramp && !!this.snapshot?.recovery;
  }

  start() {
    this.pending ??= (async () => {
      try {
        const session = await this.open((snapshot) => this.observe(snapshot));
        this.session = session;
        if (this.ending) {
          await session.release();
          return;
        }
        session.follow(this.report.startingLoad ?? 50);
      } catch (error) {
        void this.finish('fault', (error as Error).message);
      }
    })();
    return this.pending;
  }

  private observe(snapshot: SessionSnapshot) {
    const eased = snapshot.recovery && !this.snapshot?.recovery;
    this.snapshot = snapshot;
    if (eased && this.phase === 'running' && !this.ramp) {
      // Keep a record of each warm-up pause for the assessment report.
      const pauses = (this.report.warmupPauses ??= []);
      if (pauses.length < 50)
        pauses.push({ elapsed: this.report.elapsed, reason: snapshot.message });
    }
    if (this.phase === 'waiting' && snapshot.state === 'active') {
      this.phase = 'running';
      this.last = this.now();
    } else if (
      ['waiting', 'running'].includes(this.phase) &&
      ['ended', 'faulted'].includes(snapshot.state)
    )
      void this.finish('fault', snapshot.message);
    this.changed();
  }

  tick(t: Telemetry) {
    if (this.phase !== 'running' || !this.session) return;
    this.recordTelemetry(t);
    const now = this.now();
    const dt = (now - this.last!) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0 || dt > 2.5) {
      if (this.ramp) void this.finish('fault', 'Assessment timing was interrupted.');
      return;
    }
    if (dt === 0) return;
    if (this.ramp && this.snapshot?.recovery) {
      // Cadence stayed low for several seconds: the rider could not hold the step.
      void this.finish('effort', '');
      return;
    }
    if (this.warmupPaused) return;
    const powerFresh =
      Number.isFinite(t.power) &&
      t.powerAt !== undefined &&
      t.powerAt <= now &&
      now - t.powerAt <= staleTelemetryMs;
    const ack = this.snapshot && lastPowerAcknowledgement(this.snapshot);
    const start = this.report.elapsed;
    this.report.elapsed = Math.min(
      ftpDuration(this.report.protocol, this.report.startingLoad),
      start + dt,
    );
    if (powerFresh && ack && t.power! >= 0 && t.power! <= 3000)
      this.report.readings.push({
        start,
        end: this.report.elapsed,
        power: t.power!,
        cadence: Number.isFinite(t.cadence) ? t.cadence! : 0,
        target: ftpTarget(this.report.protocol, start, this.report.startingLoad),
        acknowledged: ack.watts,
      });
    if (this.report.elapsed >= ftpDuration(this.report.protocol, this.report.startingLoad)) {
      void this.finish(
        'fault',
        'You reached the top of this protocol without finishing. No FTP was set; choose the standard ramp next time.',
      );
      return;
    }
    try {
      this.session.follow(
        ftpTarget(this.report.protocol, this.report.elapsed, this.report.startingLoad),
      );
    } catch (error) {
      void this.finish('fault', (error as Error).message);
    }
    this.changed();
  }

  /** Ease to the starting load (e.g. while the page is hidden) without ending the test. */
  hold() {
    this.session?.hold();
  }

  finish(kind: 'effort' | 'cancel' | 'fault', reason = ''): Promise<void> {
    if (this.ending) return this.ending;
    if (this.currentTelemetry) this.recordTelemetry(this.currentTelemetry());
    this.phase = 'finishing';
    this.report.reason = reason;
    this.ending = Promise.resolve().then(async () => {
      try {
        await this.pending;
        await this.session?.release();
        const ended = this.snapshot;
        // A confirmed flat road (or Stop) is required before a result is trusted.
        this.report.stopConfirmed = !!(ended?.releaseConfirmed || ended?.stopConfirmed);
        if (kind === 'effort' && this.report.stopConfirmed) {
          const result = estimateFtp(this.report.readings);
          Object.assign(this.report, result, { status: result.ftp ? 'estimated' : 'invalid' });
        } else {
          this.report.status = kind === 'cancel' ? 'cancelled' : 'invalid';
          this.report.reason ||=
            kind === 'cancel'
              ? 'Assessment cancelled. FTP unchanged.'
              : 'Trainer control could not be confirmed. FTP unchanged; check the trainer load.';
        }
      } catch (error) {
        this.report.status = 'invalid';
        this.report.reason = `Trainer shutdown failed: ${(error as Error).message}. FTP unchanged.`;
      }
      this.phase = 'finished';
      this.report.controlAudit = this.snapshot?.audit;
      this.report.controlMessage = this.snapshot?.message;
      this.changed();
    });
    this.changed();
    return this.ending;
  }

  private recordTelemetry(t: Telemetry) {
    if (Number.isFinite(t.receivedAt))
      this.report.lastTelemetry = Object.fromEntries(
        Object.entries(t).filter(([, value]) => Number.isFinite(value)),
      ) as Telemetry;
  }
}
