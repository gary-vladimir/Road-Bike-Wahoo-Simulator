import type { Telemetry } from '../trainer/ftms';
import type { PilotSnapshot } from '../trainer/pilot';
import { lastPowerAcknowledgement } from '../trainer/pilot-evidence';
import {
  estimateFtp,
  ftpDuration,
  ftpTarget,
  ftpWarmupSeconds,
  type FtpAssessment,
  type FtpProtocol,
  type FtpStartingLoad,
} from './ftp-test';

type Adapter = {
  start: (ready: { baselineConfirmed: boolean; trainerProfileConfirmed: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  setTarget: (watts: number) => void;
};
export class FtpControl {
  phase: 'waiting' | 'running' | 'stopping' | 'paused' | 'finished' = 'waiting';
  snapshot?: PilotSnapshot;
  report: FtpAssessment;
  private adapter?: Adapter;
  private pending?: Promise<void>;
  private ending?: Promise<void>;
  private last?: number;
  constructor(
    protocol: FtpProtocol,
    private prepare: (changed: (s: PilotSnapshot) => void) => Promise<Adapter>,
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
  start() {
    this.pending ??= this.arm();
    return this.pending;
  }
  private async arm() {
    try {
      this.adapter = await this.prepare((snapshot) => {
        this.snapshot = snapshot;
        if (this.phase === 'waiting' && snapshot.state === 'running') {
          this.phase = 'running';
          this.last = this.now();
        } else if (
          ['waiting', 'running'].includes(this.phase) &&
          ['stopping', 'stopped', 'faulted'].includes(snapshot.state)
        ) {
          void this.interrupt(snapshot.message);
        }
        this.changed();
      });
      if (this.phase !== 'waiting') {
        await this.adapter.stop();
        return;
      }
      await this.adapter.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    } catch (error) {
      void this.finish('fault', (error as Error).message);
    }
  }
  tick(t: Telemetry) {
    if (this.phase !== 'running') return;
    // Keep the failing observation too; valid ramp readings alone hide cadence dropouts.
    this.recordTelemetry(t);
    const now = this.now();
    const dt = (now - this.last!) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 2.5) {
      if (dt === 0) return;
      void this.interrupt('Assessment timing was interrupted.');
      return;
    }
    const ack = this.snapshot && lastPowerAcknowledgement(this.snapshot);
    if (
      !ack ||
      !Number.isFinite(t.power) ||
      t.power! < 0 ||
      t.power! > 3000 ||
      !Number.isFinite(t.cadence) ||
      t.cadence! < 50 ||
      t.cadence! > 250 ||
      ![t.powerAt, t.cadenceAt].every(
        (at) => at !== undefined && Number.isFinite(at) && at <= now && now - at <= 2500,
      )
    ) {
      void this.interrupt(
        t.cadence !== undefined && t.cadence < 50
          ? `Trainer reported ${t.cadence} rpm, below the 50 rpm ERG minimum. Download the report if you were still pedaling steadily.`
          : 'Power or cadence became unreliable. Check the trainer connection and wait for fresh readings.',
      );
      return;
    }
    const start = this.report.elapsed;
    this.report.elapsed = Math.min(
      ftpDuration(this.report.protocol, this.report.startingLoad),
      start + dt,
    );
    this.report.readings.push({
      start,
      end: this.report.elapsed,
      power: t.power!,
      cadence: t.cadence!,
      target: ftpTarget(this.report.protocol, start, this.report.startingLoad),
      acknowledged: ack.watts,
    });
    if (this.report.elapsed >= ftpDuration(this.report.protocol, this.report.startingLoad)) {
      void this.finish(
        'fault',
        'You reached the test ceiling without declaring your limit. No FTP was set; choose a suitable protocol for a future test.',
      );
    } else {
      try {
        this.adapter!.setTarget(
          ftpTarget(this.report.protocol, this.report.elapsed, this.report.startingLoad),
        );
      } catch (error) {
        void this.finish('fault', (error as Error).message);
      }
    }
    this.changed();
  }
  private interrupt(reason: string) {
    return this.finish(
      this.phase === 'running' && this.report.elapsed < ftpWarmupSeconds ? 'warmup-pause' : 'fault',
      reason,
    );
  }
  resumeWarmup() {
    if (
      this.phase !== 'paused' ||
      !this.report.stopConfirmed ||
      this.report.elapsed >= ftpWarmupSeconds
    )
      return Promise.resolve();
    this.phase = 'waiting';
    this.adapter = undefined;
    this.pending = undefined;
    this.ending = undefined;
    this.snapshot = undefined;
    this.last = undefined;
    this.report.reason = '';
    this.report.stopConfirmed = false;
    this.changed();
    return this.start();
  }
  finish(kind: 'effort' | 'cancel' | 'fault' | 'warmup-pause', reason = ''): Promise<void> {
    // A paused warm-up has already completed shutdown, but must still be cancellable.
    if (this.phase === 'paused' && kind !== 'warmup-pause') this.ending = undefined;
    if (this.ending) return this.ending;
    const recoverable =
      kind === 'warmup-pause' && this.phase === 'running' && this.report.elapsed < ftpWarmupSeconds;
    if (this.currentTelemetry) this.recordTelemetry(this.currentTelemetry());
    this.phase = 'stopping';
    this.report.reason = reason;
    this.ending = Promise.resolve().then(async () => {
      try {
        await Promise.all([this.adapter?.stop(), this.pending]);
        this.report.stopConfirmed = this.snapshot?.stopConfirmed === true;
        if (recoverable && this.report.stopConfirmed) {
          this.report.warmupPauses ??= [];
          this.report.warmupPauses.push({ elapsed: this.report.elapsed, reason });
          this.report.warmupPauses = this.report.warmupPauses.slice(-50);
          this.report.reason = `Warm-up paused. ${reason} Let the flywheel slow, then resume deliberately when the load feels comfortable.`;
        } else if (
          kind === 'effort' &&
          this.report.stopConfirmed &&
          this.snapshot?.state === 'stopped'
        ) {
          const result = estimateFtp(this.report.readings);
          Object.assign(this.report, result, { status: result.ftp ? 'estimated' : 'invalid' });
        } else {
          this.report.status = kind === 'cancel' ? 'cancelled' : 'invalid';
          this.report.reason ||=
            kind === 'cancel'
              ? 'Assessment cancelled. FTP unchanged.'
              : 'Trainer shutdown could not be verified. FTP unchanged; physical load is unknown.';
        }
      } catch (error) {
        this.report.status = 'invalid';
        this.report.reason = `Trainer shutdown failed: ${(error as Error).message}. FTP unchanged; physical load is unknown.`;
      }
      this.phase =
        recoverable && this.report.stopConfirmed && this.report.status === 'in-progress'
          ? 'paused'
          : 'finished';
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
