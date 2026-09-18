import type { Telemetry } from '../trainer/ftms';
import type { PilotSnapshot } from '../trainer/pilot';
import { lastPowerAcknowledgement } from '../trainer/pilot-evidence';
import {
  estimateFtp,
  ftpDuration,
  ftpTarget,
  type FtpAssessment,
  type FtpProtocol,
} from './ftp-test';

type Adapter = {
  start: (ready: { baselineConfirmed: boolean; trainerProfileConfirmed: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  setTarget: (watts: number) => void;
};
export class FtpControl {
  phase: 'waiting' | 'running' | 'stopping' | 'finished' = 'waiting';
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
  ) {
    this.report = {
      version: 1,
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      protocol,
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
          void this.finish('fault', snapshot.message);
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
    const now = this.now();
    const dt = (now - this.last!) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 2.5) {
      if (dt === 0) return;
      void this.finish('fault', 'Assessment timing was interrupted. Start a fresh test.');
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
      void this.finish(
        'fault',
        'Power or cadence became unreliable. This attempt cannot set FTP; your previous FTP is unchanged.',
      );
      return;
    }
    const start = this.report.elapsed;
    this.report.elapsed = Math.min(ftpDuration(this.report.protocol), start + dt);
    this.report.readings.push({
      start,
      end: this.report.elapsed,
      power: t.power!,
      cadence: t.cadence!,
      target: ftpTarget(this.report.protocol, start),
      acknowledged: ack.watts,
    });
    if (this.report.elapsed >= ftpDuration(this.report.protocol)) {
      void this.finish(
        'fault',
        'You reached the test ceiling without declaring your limit. No FTP was set; choose a suitable protocol for a future test.',
      );
    } else {
      try {
        this.adapter!.setTarget(ftpTarget(this.report.protocol, this.report.elapsed));
      } catch (error) {
        void this.finish('fault', (error as Error).message);
      }
    }
    this.changed();
  }
  finish(kind: 'effort' | 'cancel' | 'fault', reason = ''): Promise<void> {
    if (this.ending) return this.ending;
    this.phase = 'stopping';
    this.report.reason = reason;
    this.ending = Promise.resolve().then(async () => {
      try {
        await Promise.all([this.adapter?.stop(), this.pending]);
        this.report.stopConfirmed = this.snapshot?.stopConfirmed === true;
        if (kind === 'effort' && this.report.stopConfirmed && this.snapshot?.state === 'stopped') {
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
      this.phase = 'finished';
      this.changed();
    });
    this.changed();
    return this.ending;
  }
}
