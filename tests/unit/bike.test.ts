import { describe, expect, it } from 'vitest';
import {
  stockWheel,
  nominalCircumference,
  validateWheel,
  virtualWheelRpm,
  wheelLabel,
} from '../../src/ride/bike';
describe('confirmed tire profile', () => {
  it('uses 700×32C / 32-622 and distinguishes wheel rotation from cadence', () => {
    expect(nominalCircumference(622, 32)).toBe(2155);
    expect(wheelLabel(stockWheel)).toBe('700×32C');
    expect(virtualWheelRpm(30, stockWheel)).toBeCloseTo(232.02, 1);
    expect(virtualWheelRpm(0, stockWheel)).toBe(0);
    expect(() => validateWheel(stockWheel)).not.toThrow();
    expect(() => validateWheel({ ...stockWheel, circumferenceMm: NaN })).toThrow();
  });
});
