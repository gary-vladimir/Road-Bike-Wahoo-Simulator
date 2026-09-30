import { describe, expect, it } from 'vitest';
import {
  routes,
  routeLength,
  routePosition,
  routeWorkout,
  validateRoute,
} from '../../src/ride/terrain';
import { RideEngine } from '../../src/ride/engine';

describe('distance-based SIM road and free pacing', () => {
  it('keeps live zero-watt, zero-cadence downhill motion independent from trainer speed', () => {
    const route = routes.find((r) => r.id === 'descent')!;
    const e = new RideEngine(routeWorkout(route), 'bluetooth', null, 70, { route });
    for (let t = 0; t <= 40000; t += 100)
      e.tick(t, {
        power: 0,
        cadence: 0,
        speed: 0,
        powerAt: t,
        cadenceAt: t,
        speedAt: t,
        receivedAt: t,
      });
    expect(e.state.phase).toBe('running');
    expect(e.state.power).toBe(0);
    expect(e.state.cadence).toBe(0);
    expect(e.state.distance).toBeGreaterThan(0.05);
    expect(e.state.speed).toBeGreaterThan(10);
    expect(e.session.samples.every((s) => s.power === 0)).toBe(true);
    e.pause();
    const distance = e.state.distance;
    e.tick(40100, { power: 0, powerAt: 40100, receivedAt: 40100 });
    expect(e.state.distance).toBe(distance);
  });
  it('pauses before invalid or future-dated power can corrupt road physics', () => {
    for (const data of [
      { power: NaN, powerAt: 100 },
      { power: 90, powerAt: Infinity },
      { power: 90, powerAt: 200 },
    ]) {
      const e = new RideEngine(routeWorkout(routes[0]), 'bluetooth', null, 75, {
        route: routes[0],
      });
      e.tick(0);
      e.state.phase = 'running';
      e.tick(100, { ...data, receivedAt: 100 });
      expect(e.state.phase).toBe('paused');
      expect(e.state.distance).toBe(0);
      expect(e.session.samples).toEqual([]);
    }
  });
  it('validates the catalog and integrates elevation including a grade zero crossing', () => {
    routes.forEach((r) => expect(() => validateRoute(r)).not.toThrow());
    const r = {
      ...routes[0],
      points: [
        { meters: 0, grade: 2 },
        { meters: 1000, grade: -2 },
      ],
    };
    expect(routePosition(r, 500)).toMatchObject({ grade: 0, elevation: 5, ascent: 5 });
    expect(routePosition(r, 1000)).toMatchObject({ grade: -2, elevation: 0, ascent: 5 });
    expect(routePosition(r, 2000).remaining).toBe(0);
    expect(() =>
      validateRoute({
        ...r,
        points: [
          { meters: 0, grade: 0 },
          { meters: 0, grade: 1 },
        ],
      }),
    ).toThrow();
  });
  it('allows a live free ride without FTP and keeps low cadence/coasting valid', () => {
    const e = new RideEngine(routeWorkout(routes[0]), 'bluetooth', null, 75, { route: routes[0] });
    for (let t = 0; t <= 15000; t += 100)
      e.tick(t, { power: 90, cadence: 35, receivedAt: t, powerAt: t, cadenceAt: t });
    expect(e.state.phase).toBe('running');
    expect(e.state.target).toBe(0);
    expect(e.state.cadence).toBe(35);
    expect(e.session.ftp).toBeNull();
    expect(e.session.mode).toBe('sim');
    const distance = e.state.distance;
    e.tick(15100, { power: 0, cadence: 0, powerAt: 15100, cadenceAt: 15100, receivedAt: 15100 });
    expect(e.state.phase).toBe('running');
    expect(e.state.distance).toBeGreaterThan(distance);
    e.tick(19000, { power: 0, powerAt: 15100, receivedAt: 19000 });
    expect(e.state.phase).toBe('paused');
  });
  it('finishes at route distance, snapshots the profile, and permits demo coasting', () => {
    const route = {
      ...routes[0],
      points: [
        { meters: 0, grade: 0 },
        { meters: 100, grade: 0 },
      ],
    };
    const e = new RideEngine(routeWorkout(route), 'demo', null, 75, { route });
    route.points[1].grade = 5;
    e.setDemoEffort(200);
    for (let t = 0; t <= 120000 && e.state.phase !== 'finished'; t += 100) e.tick(t);
    expect(e.session.status).toBe('completed');
    expect(e.session.distance).toBeCloseTo(0.1);
    expect(e.session.elapsed).toBeLessThan(120);
    expect(e.session.route?.points[1].grade).toBe(0);
    const coast = new RideEngine(routeWorkout(routes[0]), 'demo', null, 75, { route: routes[0] });
    coast.setDemoEffort(0);
    for (let t = 0; t <= 12000; t += 100) coast.tick(t);
    expect(coast.state.power).toBe(0);
    expect(coast.state.cadence).toBe(0);
    expect(coast.state.distance).toBe(0);
  });
  it('holds the same hill at the same distance regardless of power or interval clock', () => {
    const r = routes[1];
    const e = new RideEngine(routeWorkout(r), 'demo', null, 75, { route: r });
    e.state.distance = 1.6;
    e.state.elapsed = 500;
    e.state.phase = 'paused';
    e.tick(1000);
    e.tick(2000);
    expect(e.state.distance).toBe(1.6);
    expect(routePosition(r, 1600).grade).toBe(4);
    expect(routeLength(r)).toBe(6000);
  });
});
