import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlQueue, encodeControl, type ControlWire } from '../../src/trainer/control';
import { PowerSupervisor } from '../../src/safety/supervisor';
import type { Telemetry } from '../../src/trainer/ftms';
const limits = { min: 0, max: 2000, increment: 1, ceiling: 150 };
class Wire implements ControlWire {
  writes: number[][] = [];
  callback?: (v: DataView) => void;
  auto = false;
  hold = false;
  subscribe(callback: (v: DataView) => void) {
    this.callback = callback;
    return () => {
      this.callback = undefined;
    };
  }
  async write(bytes: Uint8Array) {
    this.writes.push(Array.from(bytes));
    if (this.hold) await new Promise(() => {});
    if (this.auto) this.ack(bytes[0]);
  }
  ack(opcode: number, result = 1) {
    this.callback?.(new DataView(Uint8Array.from([0x80, opcode, result]).buffer));
  }
}
const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('bounded FTMS control preparation — mock transport only', () => {
  it('does not start a deferred platform write after the connection closes', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const result = expect(q.send({ kind: 'power', watts: 50 })).rejects.toThrow('closed');
    q.close();
    await flush();
    await result;
    expect(wire.writes).toEqual([]);
  });
  it('encodes only allowed pilot commands and refuses unsafe values', () => {
    expect(Array.from(encodeControl({ kind: 'power', watts: 100 }, limits))).toEqual([5, 100, 0]);
    expect(Array.from(encodeControl({ kind: 'stop' }, limits))).toEqual([8, 1]);
    for (const watts of [NaN, Infinity, -1, 0, 39, 151, 100.5])
      expect(() => encodeControl({ kind: 'power', watts }, limits)).toThrow();
    expect(() => encodeControl({ kind: 'reset' } as never, limits)).toThrow();
    expect(() =>
      encodeControl({ kind: 'power', watts: 51 }, { ...limits, increment: 5 }),
    ).toThrow();
  });
  it('serializes writes and waits for the matching indication', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const a = q.send({ kind: 'request' });
    const b = q.send({ kind: 'power', watts: 100 });
    await flush();
    expect(wire.writes).toEqual([[0]]);
    wire.ack(5);
    await flush();
    expect(wire.writes).toHaveLength(1);
    wire.ack(0);
    await a;
    await flush();
    expect(wire.writes).toEqual([[0], [5, 100, 0]]);
    wire.ack(5);
    await b;
    q.close();
  });
  it('prioritizes stop over queued power and rejects later commands', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const a = q.send({ kind: 'request' });
    const b = q.send({ kind: 'power', watts: 100 });
    const cancelled = expect(b).rejects.toThrow('Superseded');
    const stop = q.stop();
    await flush();
    wire.ack(0);
    await a;
    await flush();
    expect(wire.writes).toEqual([[0], [8, 1]]);
    wire.ack(8);
    await stop;
    await cancelled;
    await expect(q.send({ kind: 'start' })).rejects.toThrow('stopped or faulted');
    q.close();
  });
  it('times out without retrying and permits only explicit stop after a settled write', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const command = q.send({ kind: 'request' });
    const failure = expect(command).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(2501);
    await failure;
    expect(wire.writes).toEqual([[0]]);
    const stop = q.stop();
    await flush();
    wire.ack(0);
    wire.ack(8);
    await stop;
    expect(wire.writes).toEqual([[0], [8, 1]]);
    q.close();
  });
  it('does not overlap an unresolved platform write with stop', async () => {
    const wire = new Wire();
    wire.hold = true;
    const q = new ControlQueue(wire, limits);
    const a = expect(q.send({ kind: 'request' })).rejects.toThrow('timed out');
    const b = expect(q.stop()).rejects.toThrow('stalled');
    await vi.advanceTimersByTimeAsync(2501);
    await a;
    await b;
    expect(wire.writes).toEqual([[0]]);
    q.close();
  });
  it('stops queued load commands after a refusal or disconnect', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const a = expect(q.send({ kind: 'request' })).rejects.toThrow('rejected');
    const b = expect(q.send({ kind: 'power', watts: 50 })).rejects.toThrow('rejected');
    await flush();
    wire.ack(0, 5);
    await a;
    await b;
    expect(wire.writes).toEqual([[0]]);
    q.close();
  });
  it('arms at 50 W, ramps by at most 10 W per second, and stops on stale data', async () => {
    const wire = new Wire();
    wire.auto = true;
    const q = new ControlQueue(wire, limits);
    let now = 1000;
    let t: Telemetry = { power: 50, cadence: 80, receivedAt: now, powerAt: now, cadenceAt: now };
    const supervisor = new PowerSupervisor(
      q,
      limits,
      () => t,
      () => now,
    );
    await supervisor.arm();
    expect(supervisor.state).toBe('running');
    expect(wire.writes).toEqual([[0], [5, 50, 0], [7]]);
    now += 1000;
    t = { ...t, powerAt: now, cadenceAt: now };
    await supervisor.update(150);
    expect(supervisor.applied).toBe(60);
    now += 500;
    t = { ...t, powerAt: now, cadenceAt: now };
    await supervisor.update(150);
    expect(supervisor.applied).toBe(60);
    now += 3000;
    await supervisor.update(150);
    expect(supervisor.state).toBe('faulted');
    expect(wire.writes.at(-1)).toEqual([8, 1]);
    q.close();
  });
  it('blocks arming without cadence and faults on a stalled rider', async () => {
    const wire = new Wire();
    wire.auto = true;
    const q = new ControlQueue(wire, limits);
    let t: Telemetry = { power: 60, receivedAt: 1000, powerAt: 1000 };
    const supervisor = new PowerSupervisor(
      q,
      limits,
      () => t,
      () => 1000,
    );
    await expect(supervisor.arm()).rejects.toThrow('Fresh power and cadence');
    expect(wire.writes).toEqual([]);
    t = { ...t, cadence: 80, cadenceAt: 1000 };
    await supervisor.arm();
    t.cadence = 20;
    await supervisor.update(100);
    expect(supervisor.state).toBe('faulted');
    expect(wire.writes.at(-1)).toEqual([8, 1]);
    q.close();
  });
  it('cancels arming safely when stop is requested before control is acknowledged', async () => {
    const wire = new Wire(),
      q = new ControlQueue(wire, limits);
    const supervisor = new PowerSupervisor(
      q,
      limits,
      () => ({ power: 60, cadence: 80, powerAt: 1000, cadenceAt: 1000, receivedAt: 1000 }),
      () => 1000,
    );
    const arm = supervisor.arm();
    await flush();
    const stop = supervisor.stop();
    wire.ack(0);
    await flush();
    wire.ack(8);
    await arm;
    await stop;
    expect(supervisor.state).toBe('stopped');
    expect(wire.writes).toEqual([[0], [8, 1]]);
    q.close();
  });
});
