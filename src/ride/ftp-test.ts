export type FtpProtocol = 'gentle' | 'standard';
export const ftpProtocols = Object.freeze({
  gentle: { name: 'Gentle ramp', start: 50, step: 10, ceiling: 300 },
  standard: { name: 'Standard ramp', start: 100, step: 20, ceiling: 600 },
});
export const ftpWarmupSeconds = 300;
export type FtpReading = {
  start: number;
  end: number;
  power: number;
  cadence: number;
  target: number;
  acknowledged: number;
};
export type FtpAssessment = {
  version: 1;
  id: string;
  startedAt: string;
  protocol: FtpProtocol;
  status: 'in-progress' | 'estimated' | 'cancelled' | 'invalid' | 'interrupted';
  elapsed: number;
  readings: FtpReading[];
  reason: string;
  stopConfirmed: boolean;
  bestMinute?: number;
  ftp?: number;
};
export function ftpTarget(protocol: FtpProtocol, elapsed: number) {
  const p = ftpProtocols[protocol];
  return elapsed < ftpWarmupSeconds
    ? 50
    : Math.min(p.ceiling, p.start + Math.floor((elapsed - ftpWarmupSeconds) / 60) * p.step);
}
export function ftpDuration(protocol: FtpProtocol) {
  const p = ftpProtocols[protocol];
  return ftpWarmupSeconds + (1 + (p.ceiling - p.start) / p.step) * 60;
}
/** Time-weighted trailing windows, including partial stages, excluding the warm-up. */
export function estimateFtp(readings: FtpReading[]) {
  let best = 0;
  let expected = 0;
  const ramp = readings.filter((r) => r.end > ftpWarmupSeconds);
  if (!ramp.length || ramp.at(-1)!.end < ftpWarmupSeconds + 180)
    return { reason: 'Complete at least three ramp minutes before finishing your effort.' };
  for (let i = 0; i < ramp.length; i++) {
    const end = ramp[i].end;
    const start = end - 60;
    if (start < ftpWarmupSeconds) continue;
    let covered = 0;
    let watts = 0;
    let target = 0;
    let cursor = end;
    for (let j = i; j >= 0 && ramp[j].end > start; j--) {
      const r = ramp[j];
      if (Math.abs(r.end - cursor) > 0.001) break;
      const seconds = Math.min(end, r.end) - Math.max(start, r.start);
      if (
        seconds <= 0 ||
        ![r.power, r.cadence, r.acknowledged].every(Number.isFinite) ||
        r.power < 0 ||
        r.cadence < 50
      )
        break;
      covered += seconds;
      watts += seconds * r.power;
      target += seconds * r.acknowledged;
      cursor = r.start;
    }
    if (covered >= 59.999 && watts / covered > best) {
      best = watts / covered;
      expected = target / covered;
    }
  }
  if (!best)
    return { reason: 'No continuous minute of valid ramp power and cadence was recorded.' };
  if (Math.abs(best - expected) > Math.max(10, expected * 0.15))
    return {
      reason:
        'Measured power did not track the acknowledged ERG target closely enough. Check trainer response before retesting.',
    };
  const ftp = Math.round(best * 0.75);
  if (ftp < 50 || ftp > 600)
    return { reason: 'The estimate is outside BikeSIM’s supported 50–600 W FTP range.' };
  return {
    ftp,
    bestMinute: best,
    reason: 'Estimated as 75% of your best measured 60-second ramp power.',
  };
}
export function validateFtpAssessment(value: FtpAssessment) {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    !value.id ||
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !Object.hasOwn(ftpProtocols, value.protocol) ||
    !['in-progress', 'estimated', 'cancelled', 'invalid', 'interrupted'].includes(value.status) ||
    !Number.isFinite(value.elapsed) ||
    value.elapsed < 0 ||
    value.elapsed > ftpDuration(value.protocol) + 3 ||
    typeof value.reason !== 'string' ||
    typeof value.stopConfirmed !== 'boolean' ||
    !Array.isArray(value.readings) ||
    value.readings.length > 20000
  )
    throw new Error('Invalid FTP assessment.');
  let previous = 0;
  for (const r of value.readings) {
    if (
      !r ||
      ![r.start, r.end, r.power, r.cadence, r.target, r.acknowledged].every(Number.isFinite) ||
      r.start < previous - 0.001 ||
      r.end <= r.start ||
      r.end - r.start > 2.5 ||
      r.end > value.elapsed + 0.001 ||
      r.power < 0 ||
      r.power > 3000 ||
      r.cadence < 0 ||
      r.cadence > 250 ||
      r.target < 50 ||
      r.target > ftpProtocols[value.protocol].ceiling ||
      r.acknowledged < 50 ||
      r.acknowledged > ftpProtocols[value.protocol].ceiling
    )
      throw new Error('Invalid FTP power readings.');
    previous = r.end;
  }
  if (value.status === 'estimated') {
    const calculated = estimateFtp(value.readings);
    if (
      !value.stopConfirmed ||
      !calculated.ftp ||
      value.ftp !== calculated.ftp ||
      value.bestMinute !== calculated.bestMinute
    )
      throw new Error('Invalid FTP estimate.');
  } else if (value.ftp !== undefined || value.bestMinute !== undefined)
    throw new Error('An incomplete assessment cannot contain an FTP result.');
}
