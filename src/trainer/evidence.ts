import type { SessionSnapshot, SessionState } from './session';
import type { Telemetry } from './ftms';
import type { AuditEntry } from './control';

export function lastPowerAcknowledgement(snapshot: { audit: AuditEntry[] }) {
  const entry = snapshot.audit
    .filter(
      (e) =>
        e.event === 'acknowledgement' &&
        e.bytes?.[0] === 5 &&
        e.bytes.length === 3 &&
        e.result === 1,
    )
    .at(-1);
  return entry
    ? { watts: new DataView(Uint8Array.from(entry.bytes!).buffer).getInt16(1, true), at: entry.at }
    : null;
}
export function lastGradeAcknowledgement(snapshot: { audit: AuditEntry[] }) {
  const entry = snapshot.audit
    .filter(
      (e) =>
        e.event === 'acknowledgement' &&
        e.bytes?.[0] === 0x11 &&
        e.bytes.length === 7 &&
        e.result === 1,
    )
    .at(-1);
  return entry
    ? {
        grade: new DataView(Uint8Array.from(entry.bytes!).buffer).getInt16(3, true) / 100,
        at: entry.at,
      }
    : null;
}
export type EvidenceSample = {
  at: number;
  phase: SessionState;
  requested: number | null;
  acknowledged: number | null;
  acknowledgedAt: number | null;
  power: number | null;
  powerAt: number | null;
  cadence: number | null;
  cadenceAt: number | null;
  speed: number | null;
  grade?: number;
  requestedGrade?: number;
};
const fresh = (value: number | undefined, at: number | undefined, now: number) =>
  Number.isFinite(value) &&
  at !== undefined &&
  Number.isFinite(at) &&
  at <= now &&
  now - at <= 2500;

/** Passive observation only: never sends commands or derives measured power from targets. */
export class ControlEvidence {
  samples: EvidenceSample[] = [];
  timeOrigin = performance.timeOrigin;
  droppedSamples = 0;
  begin(now: number) {
    this.samples = this.samples
      .filter((s) => s.at >= now - 10000 && ['waiting', 'ended', 'faulted'].includes(s.phase))
      .map((s) => ({
        ...s,
        requested: null,
        acknowledged: null,
        acknowledgedAt: null,
      }));
    this.droppedSamples = 0;
  }
  record(now: number, t: Telemetry, snapshot: SessionSnapshot) {
    const ack = lastPowerAcknowledgement(snapshot);
    this.samples.push({
      at: now,
      phase: snapshot.state,
      requested:
        snapshot.mode === 'sim' || snapshot.state === 'waiting'
          ? null
          : (snapshot.requestedWatts ?? null),
      ...(snapshot.mode === 'sim'
        ? { grade: snapshot.appliedGrade, requestedGrade: snapshot.requestedGrade }
        : {}),
      acknowledged: ack?.watts ?? null,
      acknowledgedAt: ack?.at ?? null,
      power: fresh(t.power, t.powerAt, now) ? t.power! : null,
      powerAt: t.powerAt !== undefined && Number.isFinite(t.powerAt) ? t.powerAt : null,
      cadence: fresh(t.cadence, t.cadenceAt, now) ? t.cadence! : null,
      cadenceAt: t.cadenceAt !== undefined && Number.isFinite(t.cadenceAt) ? t.cadenceAt : null,
      speed: fresh(t.speed, t.speedAt, now) ? t.speed! : null,
    });
    if (this.samples.length > 1200) {
      this.samples.shift();
      this.droppedSamples++;
    }
  }
  report(snapshot: SessionSnapshot) {
    return {
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      timeOrigin: this.timeOrigin,
      note: 'Times are milliseconds relative to timeOrigin. Telemetry is trainer-reported, not independent power verification. First 10 seconds after each target acknowledgement are excluded from settled averages. No automatic pass/fail or load change. Retains up to 1200 samples.',
      ...snapshot,
      samples: [...this.samples],
      droppedSamples: this.droppedSamples,
      plateaus: summarizePlateaus(this.samples),
    };
  }
}
export type ControlReport = ReturnType<ControlEvidence['report']>;
export function summarizePlateaus(samples: EvidenceSample[]) {
  const groups: EvidenceSample[][] = [];
  let current: EvidenceSample[] | undefined;
  for (const s of samples) {
    if (s.phase !== 'active' || s.acknowledged === null || s.acknowledged !== s.requested) {
      current = undefined;
      continue;
    }
    const previous = current?.at(-1);
    if (!previous || previous.acknowledgedAt !== s.acknowledgedAt || s.at - previous.at > 2500) {
      current = [];
      groups.push(current);
    }
    current!.push(s);
  }
  return groups.map((group) => {
    const first = group[0],
      last = group.at(-1)!;
    // Polls may repeat a sensor packet: count each power/cadence timestamp once.
    const power = new Map<number, number>(),
      cadence = new Map<number, number>();
    const settlingEnds = Math.max(first.at, first.acknowledgedAt!) + 10000;
    for (const s of group) {
      if (s.at < settlingEnds) continue;
      if (s.power !== null && s.powerAt !== null && s.powerAt >= settlingEnds)
        power.set(s.powerAt, s.power);
      if (s.cadence !== null && s.cadenceAt !== null && s.cadenceAt >= settlingEnds)
        cadence.set(s.cadenceAt, s.cadence);
    }
    const average = (values: Map<number, number>) =>
      values.size ? [...values.values()].reduce((a, b) => a + b, 0) / values.size : null;
    return {
      at: first.at,
      target: first.acknowledged!,
      observedSeconds: (last.at - first.at) / 1000,
      settledSamples: power.size,
      averagePower: average(power),
      averageCadence: average(cadence),
    };
  });
}
