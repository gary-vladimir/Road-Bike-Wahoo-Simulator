import { describe, expect, it } from 'vitest';
import { decodeFeatures, decodeIndoorBikeData, decodePowerRange } from '../../src/trainer/ftms';
const packet = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
describe('FTMS telemetry codec — synthetic specification fixtures', () => {
  it('decodes little-endian power, half-rpm cadence and hundredth km/h speed', () => {
    expect(decodeIndoorBikeData(packet(0x44, 0, 0xb8, 0xb, 180, 0, 250, 0))).toEqual({
      speed: 30,
      cadence: 90,
      power: 250,
    });
  });
  it('handles continuation packets with no speed and signed power', () => {
    expect(decodeIndoorBikeData(packet(0x41, 0, 0xf6, 0xff))).toEqual({ power: -10 });
  });
  it('skips optional fields without corrupting power offset', () => {
    expect(
      decodeIndoorBikeData(packet(0x7e, 0, 0, 0, 0, 0, 180, 0, 170, 0, 1, 2, 3, 0, 0, 120, 0)),
    ).toEqual({ speed: 0, cadence: 90, power: 120 });
  });
  it('rejects truncation at every byte of a complete packet', () => {
    const bytes = [0x44, 0, 0xb8, 0xb, 180, 0, 250, 0];
    for (let n = 0; n < bytes.length; n++)
      expect(() => decodeIndoorBikeData(packet(...bytes.slice(0, n)))).toThrow();
  });
  it('does not invent cadence when absent', () => {
    expect(decodeIndoorBikeData(packet(0, 0, 0, 0))).toEqual({ speed: 0 });
  });
  it('checks capability and target-range records', () => {
    const features = decodeFeatures(packet(2, 64, 0, 0, 8, 32, 0, 0));
    expect(features).toMatchObject({ cadence: true, power: true, erg: true, simulation: true });
    expect(decodePowerRange(packet(0, 0, 0xc8, 0, 1, 0))).toEqual({
      min: 0,
      max: 200,
      increment: 1,
    });
    expect(() => decodePowerRange(packet(0, 0, 0xc8, 0, 0, 0))).toThrow();
  });
});
