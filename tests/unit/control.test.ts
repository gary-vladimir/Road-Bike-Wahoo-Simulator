import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlQueue, encodeControl, type ControlWire } from '../../src/trainer/control';
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
  it('encodes signed little-endian SIM slope and coefficients within an explicit grant', () => {
    const grant = { ...limits, simulation: { minGrade: -10, maxGrade: 12 } };
    const sim = (grade: number, windSpeed = 0) =>
      ({
        kind: 'simulation',
        grade,
        windSpeed,
        rollingResistance: 0.004,
        windResistance: 0.16,
      }) as const;
    expect([...encodeControl(sim(-1.5), grant)]).toEqual([0x11, 0, 0, 0x6a, 0xff, 40, 16]);
    expect([...encodeControl(sim(2, -1.25), grant)]).toEqual([0x11, 0x1e, 0xfb, 200, 0, 40, 16]);
    expect([...encodeControl(sim(12), grant)]).toEqual([0x11, 0, 0, 0xb0, 0x04, 40, 16]);
    expect(() => encodeControl(sim(1), limits)).toThrow('not authorized');
    for (const grade of [NaN, Infinity, -10.5, 12.5])
      expect(() => encodeControl(sim(grade), grant)).toThrow();
    // No grant may exceed the app-wide cap, whatever a caller asks for.
    expect(() =>
      encodeControl(sim(0), { ...limits, simulation: { minGrade: -20, maxGrade: 20 } }),
    ).toThrow();
  });
});
