export type Telemetry = {
  power?: number;
  cadence?: number;
  speed?: number;
  heartRate?: number;
  receivedAt: number;
  powerAt?: number;
  cadenceAt?: number;
  speedAt?: number;
};
/** Bluetooth SIG Indoor Bike Data. Missing fields remain absent, never zero-filled. */
export function decodeIndoorBikeData(view: DataView): Omit<Telemetry, 'receivedAt'> {
  let offset = 0;
  const need = (bytes: number) => {
    if (offset + bytes > view.byteLength) throw new Error('Truncated Indoor Bike Data packet');
  };
  const u16 = () => {
    need(2);
    const n = view.getUint16(offset, true);
    offset += 2;
    return n;
  };
  const i16 = () => {
    need(2);
    const n = view.getInt16(offset, true);
    offset += 2;
    return n;
  };
  const skip = (n: number) => {
    need(n);
    offset += n;
  };
  const flags = u16();
  if (flags & 0xe000) throw new Error('Unsupported reserved Indoor Bike Data flags');
  const result: Omit<Telemetry, 'receivedAt'> = {};
  if (!(flags & 1)) result.speed = u16() / 100;
  if (flags & 2) skip(2);
  if (flags & 4) result.cadence = u16() / 2;
  if (flags & 8) skip(2);
  if (flags & 16) skip(3);
  if (flags & 32) skip(2);
  if (flags & 64) result.power = i16();
  if (flags & 128) skip(2);
  if (flags & 256) skip(5);
  if (flags & 512) {
    need(1);
    result.heartRate = view.getUint8(offset++);
  }
  if (flags & 1024) skip(1);
  if (flags & 2048) skip(2);
  if (flags & 4096) skip(2);
  if (offset !== view.byteLength) throw new Error('Unexpected trailing Indoor Bike Data bytes');
  return result;
}
export function decodeFeatures(view: DataView) {
  if (view.byteLength !== 8) throw new Error('Invalid Fitness Machine Feature length');
  const machine = view.getUint32(0, true),
    targets = view.getUint32(4, true);
  return {
    machine,
    targets,
    power: !!(machine & (1 << 14)),
    cadence: !!(machine & (1 << 1)),
    erg: !!(targets & (1 << 3)),
    simulation: !!(targets & (1 << 13)),
  };
}
export function decodePowerRange(view: DataView) {
  if (view.byteLength !== 6) throw new Error('Invalid supported power range length');
  const min = view.getInt16(0, true),
    max = view.getInt16(2, true),
    increment = view.getUint16(4, true);
  if (min > max || increment === 0) throw new Error('Invalid supported power range');
  return { min, max, increment };
}
