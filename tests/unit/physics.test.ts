import { describe, expect, it } from 'vitest';
import {
  advance,
  airDensity,
  coastStatus,
  coastingSpeed,
  createSetup,
  roadForces,
  wheelInertiaMass,
  windCoefficient,
} from '../../src/ride/physics';

const rider = createSetup({ riderMass: 70, bikeMass: 9 });
const run = (speed: number, power: number, grade: number, seconds: number, dt = 1) => {
  let distance = 0;
  for (let t = 0; t < Math.round(seconds / dt); t++) {
    const step = advance(speed, power, grade, rider, dt);
    speed = step.speed;
    distance += step.distance;
  }
  return { speed, distance };
};

describe('virtual road physics', () => {
  it('uses thinner air at altitude and matches the standard atmosphere', () => {
    expect(airDensity(0, 15)).toBeCloseTo(1.225, 2);
    expect(airDensity(1550)).toBeCloseTo(0.999, 2);
    expect(airDensity(3000)).toBeLessThan(airDensity(1550));
    // Oaxaca hoods position: ½ × ρ × CdA.
    expect(windCoefficient(rider)).toBeCloseTo(0.5 * 0.999 * 0.32, 3);
    const aero = createSetup({ riderMass: 70, position: 'aero' });
    expect(windCoefficient(aero)).toBeLessThan(windCoefficient(rider));
  });

  it('reaches a steady flat speed where drive balances drag, faster in the aero position', () => {
    const steady = (position: 'hoods' | 'aero') => {
      const setup = createSetup({ riderMass: 70, position });
      let speed = 0;
      for (let i = 0; i < 400; i++) speed = advance(speed, 200, 0, setup, 1).speed;
      const f = roadForces(speed, 200, 0, setup);
      expect(Math.abs(f.drive - f.rolling - f.air)).toBeLessThan(0.05);
      return speed;
    };
    const hoods = steady('hoods');
    // ~34 km/h at sea level; Oaxaca altitude adds about 2 km/h at 200 W.
    expect(hoods).toBeGreaterThan(34);
    expect(hoods).toBeLessThan(38);
    expect(steady('aero')).toBeGreaterThan(hoods + 1.5);
  });

  it('slows on a shallow descent while still covering distance at zero watts', () => {
    const coast = run(26, 0, -0.25, 8);
    expect(coast.speed).toBeGreaterThan(22);
    expect(coast.speed).toBeLessThan(25);
    expect(coast.distance).toBeGreaterThan(50);
    expect(coastStatus(26, -0.25, rider)).toMatchObject({ trend: 'Slowing down' });
    const forces = roadForces(26, 0, -0.25, rider);
    expect(forces.gravity).toBeGreaterThan(0);
    expect(forces.gravity).toBeLessThan(forces.air + forces.rolling);
  });

  it('accelerates or decelerates toward the same coasting speed depending on entry speed', () => {
    const balance = coastingSpeed(-3, rider);
    expect(balance).toBeGreaterThan(38);
    expect(balance).toBeLessThan(45);
    expect(advance(10, 0, -3, rider, 1).speed).toBeGreaterThan(10);
    expect(advance(60, 0, -3, rider, 1).speed).toBeLessThan(60);
    expect(coastStatus(10, -3, rider).trend).toBe('Gaining speed');
    expect(coastStatus(60, -3, rider).trend).toBe('Slowing down');
    expect(coastStatus(balance, -3, rider).trend).toBe('Steady speed');
    expect(coastingSpeed(0, rider)).toBe(0);
  });

  it('coasts from rest downhill to the analytical drag-limited speed', () => {
    const { speed, distance } = run(0, 0, -3, 600);
    const angle = Math.atan(0.03);
    const expected =
      Math.sqrt(
        (79 * 9.81 * (Math.sin(angle) - 0.004 * Math.cos(angle))) / windCoefficient(rider),
      ) * 3.6;
    expect(speed).toBeCloseTo(expected, 1);
    expect(distance).toBeGreaterThan(4000);
  });

  it('stops on flat and uphill terrain without rolling backward or adding distance', () => {
    for (const grade of [-0.25, 0, 3]) {
      expect(coastStatus(0, grade, rider).trend).toBe('Stopped');
      expect(advance(0, 0, grade, rider, 1)).toMatchObject({ speed: 0, distance: 0 });
    }
    const uphill = run(25, 0, 5, 120),
      flat = run(25, 0, 0, 120),
      downhill = run(25, 0, -3, 120);
    expect(uphill.speed).toBe(0);
    expect(uphill.distance).toBeGreaterThan(10);
    expect(uphill.distance).toBeLessThan(flat.distance);
    expect(flat.distance).toBeLessThan(downhill.distance);
  });

  it('integrates identically across tick rates', () => {
    expect(run(25, 0, 3, 10, 1).distance).toBeCloseTo(run(25, 0, 3, 10, 0.1).distance, 3);
    expect(run(25, 0, 3, 10, 0.1).distance).toBeCloseTo(run(25, 0, 3, 10, 1 / 60).distance, 2);
  });

  it('applies rider mass to climbing and descending, and wheel inertia to acceleration', () => {
    const heavy = createSetup({ riderMass: 100, bikeMass: 9 });
    expect(advance(15, 150, 5, heavy, 1).speed).toBeLessThan(advance(15, 150, 5, rider, 1).speed);
    expect(advance(30, 0, -3, heavy, 1).speed).toBeGreaterThan(advance(30, 0, -3, rider, 1).speed);
    const launch = advance(0, 300, 0, rider, 0.01).speed / 3.6 / 0.01;
    const f = roadForces(0, 300, 0, rider);
    expect(launch).toBeCloseTo((f.drive - f.rolling) / (79 + wheelInertiaMass), 1);
  });

  it('brakes toward a corner speed limit but never adds speed to reach it', () => {
    const braking = advance(55, 0, -6, rider, 1, 30);
    expect(braking.braking).toBe(true);
    expect(braking.speed).toBeLessThan(55 - 10);
    expect(advance(20, 150, 0, rider, 1, 30).speed).toBeLessThan(30);
    expect(advance(20, 150, 0, rider, 1, 30).braking).toBe(false);
  });

  it('rejects unsupported inputs', () => {
    for (const bad of [
      () => advance(NaN, 0, 0, rider, 1),
      () => advance(10, 0, 0, rider, 3),
      () => advance(10, 0, 40, rider, 1),
      () => createSetup({ riderMass: 20 }),
      () => advance(10, 0, 0, { ...rider, cda: 2 }, 1),
    ])
      expect(bad).toThrow('outside supported limits');
  });
});
