import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErgPilot, type PilotSnapshot } from '../../src/trainer/pilot';
import { RideControl, supportsRoadControl } from '../../src/ride/ride-control';
import { RideEngine } from '../../src/ride/engine';
import { routes } from '../../src/ride/terrain';
import { presets } from '../../src/workouts/model';
import { workoutPowerCeiling } from '../../src/ride/workout-control';

function fixture() {
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  let held = false;
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          await callback({});
        } finally {
          held = false;
        }
      },
    },
  });
  const writes: number[][] = [];
  let delayStop = false,
    delayPower = false,
    delaySim = false,
    power = 50,
    cadence = 80,
    stale = false;
  const point = Object.assign(new EventTarget(), {
    properties: { write: true, indicate: true },
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => point),
    writeValueWithResponse: async (bytes: ArrayBuffer) => {
      const payload = Array.from(new Uint8Array(bytes));
      writes.push(payload);
      if (
        (payload[0] !== 8 || !delayStop) &&
        (payload[0] !== 5 || !delayPower) &&
        (payload[0] !== 0x11 || !delaySim)
      )
        ack(payload[0]);
    },
  });
  function ack(opcode: number) {
    point.value = new DataView(Uint8Array.of(0x80, opcode, 1).buffer);
    point.dispatchEvent(new Event('characteristicvaluechanged'));
  }
  const status = Object.assign(new EventTarget(), {
    startNotifications: vi.fn(async () => status),
  });
  const disconnect = vi.fn();
  const device = Object.assign(new EventTarget(), {
    gatt: {
      connected: true,
      disconnect,
      getPrimaryService: async () => ({
        getCharacteristic: async (id: number) => (id === 0x2ad9 ? point : status),
      }),
    },
  }) as unknown as BluetoothDevice;
  const source = {
    device,
    range: { min: 0, max: 2000, increment: 1 },
    telemetry: () => ({
      power,
      cadence,
      receivedAt: performance.now(),
      powerAt: stale ? performance.now() - 3000 : performance.now(),
      cadenceAt: performance.now(),
    }),
  };
  const snapshots: PilotSnapshot[] = [];
  return {
    source,
    snapshots,
    writes,
    disconnect,
    document,
    ack,
    point,
    status,
    prepare: (mode: 'erg' | 'sim' = 'erg') =>
      ErgPilot.prepare(source, (s) => snapshots.push(s), mode),
    coast: () => {
      power = 0;
      cadence = 0;
    },
    delaySim: () => {
      delaySim = true;
    },
    delayStop: () => {
      delayStop = true;
    },
    delayPower: () => {
      delayPower = true;
    },
    stall: () => {
      cadence = 0;
    },
    pedal: () => {
      cadence = 80;
      stale = false;
    },
    expire: () => {
      stale = true;
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_TRAINER_CONTROL', 'pilot');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('controlled road lifecycle with synthetic GATT', () => {
  function road(route = routes[0]) {
    const f = fixture();
    const engine = new RideEngine(presets[0], 'bluetooth', null, 70, {
      route,
      trainerControl: 'sim',
    });
    const control = new RideControl(
      engine,
      (changed) => ErgPilot.prepare(f.source, changed, 'sim', 'road'),
      () => {},
    );
    return { ...f, engine, control };
  }
  it('supports the catalog but rejects terrain beyond the road envelope instead of clamping', () => {
    expect(routes.map(supportsRoadControl)).toEqual([true, true, true, true]);
    expect(
      () =>
        new RideEngine(presets[0], 'bluetooth', null, 70, {
          route: {
            ...routes[1],
            points: [
              { meters: 0, grade: 0 },
              { meters: 1000, grade: 6 },
            ],
          },
          trainerControl: 'sim',
        }),
    ).toThrow('range');
    expect(
      () =>
        new RideEngine(presets[0], 'demo', null, 70, { route: routes[0], trainerControl: 'sim' }),
    ).toThrow('range');
  });
  it('ramps to foothills climbs/descents and the catalog maximum without broadening diagnostics', async () => {
    const f = road(routes[1]);
    f.coast();
    await f.control.start();
    f.engine.state.phase = 'running';
    f.engine.state.distance = 1.6;
    f.control.update();
    await vi.advanceTimersByTimeAsync(17000);
    expect(f.control.snapshot?.grade).toBe(4);
    f.engine.state.distance = 3.2;
    f.control.update();
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.control.snapshot?.grade).toBe(-3.5);
    const grades = f.writes
      .filter((w) => w[0] === 17)
      .map((w) => new DataView(Uint8Array.from(w).buffer).getInt16(3, true) / 100);
    grades.slice(1).forEach((g, i) => expect(Math.abs(g - grades[i])).toBeLessThanOrEqual(0.25));
    expect(f.writes.every((w) => w[0] !== 5)).toBe(true);
    f.expire();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.engine.state.phase).toBe('paused');
    expect(f.writes.at(-1)).toEqual([8, 1]);
    await f.control.stop();
    const next = fixture();
    const pilot = await ErgPilot.prepare(next.source, () => {}, 'sim', 'road');
    await pilot.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    expect(() => pilot.setGrade(5.01)).toThrow('limited');
    expect(() => pilot.setGrade(-4.01)).toThrow('limited');
    pilot.setGrade(5);
    await vi.advanceTimersByTimeAsync(21000);
    expect(
      next.writes.some(
        (w) => w[0] === 17 && new DataView(Uint8Array.from(w).buffer).getInt16(3, true) === 500,
      ),
    ).toBe(true);
    await pilot.stop();
  });
  it('follows distance through climbs and descents with zero watts allowed and no ERG writes', async () => {
    const f = road();
    f.coast();
    await f.control.start();
    expect(f.control.ready).toBe(true);
    expect(f.engine.state.elapsed).toBe(0);
    f.engine.state.phase = 'running';
    f.engine.state.distance = 1;
    f.control.update();
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.control.snapshot?.grade).toBe(1);
    f.engine.state.distance = 2.4;
    f.control.update();
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.control.snapshot?.grade).toBe(-0.5);
    expect(f.writes.every((w) => w[0] !== 5)).toBe(true);
    expect(f.engine.state.phase).toBe('running');
    await f.control.stop();
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.engine.session.events.some((event) => event.message.includes('-0.5%'))).toBe(true);
  });
  it('cancels asynchronous preparation without a late Start', async () => {
    const f = road();
    let release!: () => void;
    f.status.startNotifications.mockImplementationOnce(async () => {
      await new Promise<void>((done) => {
        release = done;
      });
      return f.status;
    });
    const starting = f.control.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopped = f.control.stop();
    expect(f.control.ending).toBe(true);
    expect(f.control.ended).toBe(false);
    release();
    await Promise.all([starting, stopped]);
    expect(f.control.ended).toBe(true);
    expect(f.control.ready).toBe(false);
    expect(f.writes).toEqual([]);
    await f.control.start();
    expect(f.writes).toEqual([]);
  });
  it('waits for Stop acknowledgement before allowing a fresh resume controller', async () => {
    const f = road();
    await f.control.start();
    f.delayStop();
    f.engine.pause();
    f.control.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.control.ending).toBe(true);
    expect(f.control.ended).toBe(false);
    expect(f.control.ready).toBe(false);
    f.ack(8);
    await f.control.stop();
    expect(f.control.ended).toBe(true);
    const resumed = new RideControl(
      f.engine,
      (changed) => ErgPilot.prepare(f.source, changed, 'sim'),
      () => {},
    );
    f.engine.resume();
    await resumed.start();
    expect(resumed.ready).toBe(true);
    expect(f.writes.slice(-3)).toEqual([[0], [17, 0, 0, 0, 0, 40, 18], [7]]);
    const ending = resumed.stop();
    await vi.advanceTimersByTimeAsync(0);
    f.ack(8);
    await ending;
  });
  it('pauses on stale telemetry and never automatically resumes when readings recover', async () => {
    const f = road();
    await f.control.start();
    f.engine.state.phase = 'running';
    f.expire();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.engine.state.phase).toBe('paused');
    expect(f.control.ready).toBe(false);
    expect(f.writes.at(-1)).toEqual([8, 1]);
    f.pedal();
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.writes.filter((w) => w[0] === 7)).toHaveLength(1);
    await f.control.stop();
  });
  it('contains preparation failures and can finish a cancelled ride', async () => {
    const f = road();
    const control = new RideControl(
      f.engine,
      async () => {
        throw new Error('Connection lost');
      },
      () => {},
    );
    await control.start();
    await control.stop();
    expect(control.ended).toBe(true);
    expect(f.engine.state.phase).toBe('paused');
    expect(control.message).toContain('Connection lost');
    f.engine.finish();
    control.update();
    expect(f.engine.session.status).toBe('stopped');
    expect(f.writes).toEqual([]);
  });
  it('waits for pending startup even if the adapter unexpectedly rejects Stop', async () => {
    const f = road();
    let finishStart!: () => void;
    const control = new RideControl(
      f.engine,
      async () => ({
        start: () =>
          new Promise<void>((resolve) => {
            finishStart = resolve;
          }),
        stop: async () => {
          throw new Error('Transport failure');
        },
        setGrade: () => {},
        setTarget: () => {},
      }),
      () => {},
    );
    void control.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = control.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(control.ended).toBe(false);
    finishStart();
    await stopping;
    expect(control.ended).toBe(true);
    expect(control.message).toContain('Physical load is unknown');
  });
  it('reports an unacknowledged Stop and disconnects without retrying or claiming unloading', async () => {
    const f = road();
    await f.control.start();
    f.delayStop();
    const stopping = f.control.stop();
    await vi.advanceTimersByTimeAsync(3000);
    await stopping;
    expect(f.control.ended).toBe(true);
    expect(f.control.message).toContain('unknown');
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(f.writes.filter((w) => w[0] === 8)).toHaveLength(1);
  });
});
describe('automatic ERG workout lifecycle with synthetic GATT', () => {
  function workout() {
    const f = fixture();
    const plan = {
      ...structuredClone(presets[0]),
      blocks: [
        { ...presets[0].blocks[0], seconds: 10, from: 0.4, to: 0.6 },
        { ...presets[0].blocks[0], seconds: 10, from: 1, to: 1 },
      ],
    };
    const engine = new RideEngine(plan, 'bluetooth', 200, 70, { trainerControl: 'erg' });
    const make = () =>
      new RideControl(
        engine,
        (changed) =>
          ErgPilot.prepare(f.source, changed, 'erg', 'workout', workoutPowerCeiling(plan, 200)),
        () => {},
      );
    return { ...f, engine, make, control: make() };
  }
  it('waits for pedaling, holds 50 W through countdown and follows ramps, intervals and intensity without SIM commands', async () => {
    const f = workout();
    f.coast();
    await f.control.start();
    expect(f.control.ready).toBe(false);
    expect(f.writes).toEqual([]);
    f.pedal();
    await vi.advanceTimersByTimeAsync(300);
    expect(f.control.ready).toBe(true);
    f.control.update();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.control.snapshot?.applied).toBe(50);
    f.engine.state.phase = 'running';
    f.engine.state.elapsed = 5;
    f.control.update();
    await vi.advanceTimersByTimeAsync(6000);
    expect(f.control.snapshot?.applied).toBe(100);
    f.engine.state.elapsed = 10;
    f.control.update();
    await vi.advanceTimersByTimeAsync(11000);
    expect(f.control.snapshot?.applied).toBe(200);
    f.engine.setBias(0.8);
    f.control.update();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.control.snapshot?.applied).toBe(160);
    const watts = f.writes
      .filter((w) => w[0] === 5)
      .map((w) => new DataView(Uint8Array.from(w).buffer).getInt16(1, true));
    watts.slice(1).forEach((w, i) => expect(Math.abs(w - watts[i])).toBeLessThanOrEqual(10));
    expect(f.writes.some((w) => w[0] === 17)).toBe(false);
    f.engine.finish(true);
    f.control.update();
    await f.control.stop();
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(
      f.engine.session.events.some((e) => e.message.includes('ERG controller running: 200 W')),
    ).toBe(true);
    expect(f.disconnect).not.toHaveBeenCalled();
  });
  it('pauses on low cadence or stale power and only resumes with a new 50 W session', async () => {
    for (const fault of ['cadence', 'stale']) {
      const f = workout();
      await f.control.start();
      f.engine.state.phase = 'running';
      f.engine.state.elapsed = 10;
      f.control.update();
      await vi.advanceTimersByTimeAsync(11000);
      if (fault === 'cadence') f.stall();
      else f.expire();
      await vi.advanceTimersByTimeAsync(300);
      expect(f.engine.state.phase).toBe('paused');
      expect(f.control.ready).toBe(false);
      await f.control.stop();
      expect(f.writes.at(-1)).toEqual([8, 1]);
      f.pedal();
      const count = f.writes.length;
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.writes).toHaveLength(count);
      f.engine.resume();
      const resumed = f.make();
      await resumed.start();
      expect(f.writes.slice(-3)).toEqual([[0], [5, 50, 0], [7]]);
      expect(f.engine.state.countdown).toBe(3);
      await resumed.stop();
    }
  });
  it('cancels a waiting workout without a load write and rejects missing readiness or device range', async () => {
    const f = workout();
    f.coast();
    await f.control.start();
    await f.control.stop();
    f.pedal();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.writes).toEqual([]);
    const pilot = await ErgPilot.prepare(f.source, () => {}, 'erg', 'workout', 220);
    await expect(pilot.start()).rejects.toThrow('Confirm');
    expect(f.writes).toEqual([]);
    await expect(
      ErgPilot.prepare(
        { ...f.source, range: { min: 0, max: 150, increment: 1 } },
        () => {},
        'erg',
        'workout',
        220,
      ),
    ).rejects.toThrow('range');
  });
});
describe('supervised pilot lifecycle with synthetic GATT only', () => {
  it('starts SIM at zero watts/cadence, ramps signed slopes, and preserves telemetry after Stop', async () => {
    const f = fixture();
    f.coast();
    const pilot = await f.prepare('sim');
    await pilot.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    expect(f.writes).toEqual([[0], [0x11, 0, 0, 0, 0, 40, 18], [7]]);
    expect(f.snapshots.at(-1)).toMatchObject({ state: 'running', mode: 'sim', grade: 0 });
    expect(() => pilot.setTarget(100)).toThrow('unavailable');
    expect(() => pilot.setGrade(1.1)).toThrow('limited');
    pilot.setGrade(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.snapshots.at(-1)?.grade).toBe(1);
    pilot.setGrade(-1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.snapshots.at(-1)?.grade).toBe(-1);
    expect(f.writes.at(-1)).toEqual([0x11, 0, 0, 156, 255, 40, 18]);
    expect(f.writes.every((w) => w[0] !== 5)).toBe(true);
    await pilot.stop();
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.disconnect).not.toHaveBeenCalled();
  });
  it('requires explicit SIM readiness and excludes another ERG controller', async () => {
    const f = fixture();
    const pilot = await f.prepare('sim');
    await expect(f.prepare()).rejects.toThrow('Another BikeSIM');
    await expect(pilot.start()).rejects.toThrow('Confirm');
    expect(f.writes).toEqual([]);
    expect(f.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    const again = await f.prepare('sim');
    await again.stop();
  });
  it('waits for a SIM fault stop acknowledgement before cleanup', async () => {
    const f = fixture();
    f.coast();
    const pilot = await f.prepare('sim');
    await pilot.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    f.delayStop();
    f.expire();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.disconnect).not.toHaveBeenCalled();
    f.ack(8);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.snapshots.at(-1)?.state).toBe('faulted');
  });
  it('cancels an in-flight SIM startup without a late Start command', async () => {
    const f = fixture();
    f.delaySim();
    const pilot = await f.prepare('sim');
    const starting = pilot.start({ baselineConfirmed: true, trainerProfileConfirmed: true });
    await vi.advanceTimersByTimeAsync(0);
    const stopping = pilot.stop();
    f.ack(0x11);
    await Promise.all([starting, stopping]);
    expect(f.writes).toEqual([[0], [0x11, 0, 0, 0, 0, 40, 18], [8, 1]]);
    expect(f.disconnect).not.toHaveBeenCalled();
  });
  it('exposes selected targets immediately and captures raw machine status without extra control writes', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    await pilot.start();
    pilot.setTarget(100);
    expect(f.snapshots.at(-1)).toMatchObject({ requested: 100, applied: 50 });
    Object.assign(f.status, { value: new DataView(Uint8Array.of(0x08, 50, 0).buffer) });
    f.status.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(f.snapshots.at(-1)?.machineStatus.at(-1)?.bytes).toEqual([0x08, 50, 0]);
    expect(f.writes).toEqual([[0], [5, 50, 0], [7]]);
    await pilot.stop();
  });
  it('waits at zero cadence, cancels without writes, and can start a fresh test on the same connection', async () => {
    const f = fixture();
    f.stall();
    const pilot = await f.prepare();
    await pilot.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.snapshots.at(-1)?.state).toBe('waiting');
    expect(f.writes).toEqual([]);
    expect(f.disconnect).not.toHaveBeenCalled();
    await pilot.stop();
    expect(f.snapshots.at(-1)?.state).toBe('stopped');
    await vi.advanceTimersByTimeAsync(0);
    const retry = await f.prepare();
    await retry.start();
    f.pedal();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.snapshots.at(-1)?.state).toBe('running');
    expect(f.writes).toEqual([[0], [5, 50, 0], [7]]);
    await retry.stop();
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.snapshots.at(-1)?.state).toBe('stopped');
  });
  it('does not disconnect telemetry when notification setup fails before control starts', async () => {
    const f = fixture();
    f.point.startNotifications.mockRejectedValueOnce(new Error('Notification setup failed'));
    await expect(f.prepare()).rejects.toThrow('Notification setup failed');
    expect(f.writes).toEqual([]);
    expect(f.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    const retry = await f.prepare();
    await retry.stop();
  });
  it('continues checking cadence while a power acknowledgement is pending', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    await pilot.start();
    f.delayPower();
    f.delayStop();
    pilot.setTarget(75);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes.at(-1)).toEqual([5, 60, 0]);
    f.stall();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.disconnect).not.toHaveBeenCalled();
    f.ack(5);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.disconnect).not.toHaveBeenCalled();
    f.ack(8);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.snapshots.at(-1)?.message).toContain('Cadence below');
    expect(f.writes).toHaveLength(5);
  });
  it('blocks disabled builds before acquiring hardware access', async () => {
    const f = fixture();
    vi.stubEnv('VITE_TRAINER_CONTROL', 'off');
    await expect(f.prepare()).rejects.toThrow('disabled');
    expect(f.writes).toEqual([]);
  });
  it('prepares without writes, prevents another owner, and cancels before arming without writes', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    expect(f.writes).toEqual([]);
    await expect(f.prepare()).rejects.toThrow('Another BikeSIM tab');
    await pilot.stop();
    expect(f.writes).toEqual([]);
    expect(f.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    const again = await f.prepare();
    await again.stop();
  });
  it('refuses hidden tabs and missing acknowledged-write capabilities', async () => {
    const f = fixture();
    f.document.hidden = true;
    await expect(f.prepare()).rejects.toThrow('visible');
    f.document.hidden = false;
    f.point.properties.indicate = false;
    await expect(f.prepare()).rejects.toThrow('acknowledged');
    expect(f.writes).toEqual([]);
  });
  it('keeps the link open while a fault stop acknowledgement is pending across timer ticks', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    await pilot.start();
    f.delayStop();
    f.stall();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.writes).toEqual([[0], [5, 50, 0], [7], [8, 1]]);
    expect(f.disconnect).not.toHaveBeenCalled();
    const stopped = pilot.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.disconnect).not.toHaveBeenCalled();
    f.ack(8);
    await stopped;
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.snapshots.at(-1)?.message).toContain('Stop acknowledged');
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.writes).toHaveLength(4);
  });
  it('waits for stop timeout, reports uncertainty and never retries a target', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    await pilot.start();
    f.delayStop();
    f.expire();
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(f.snapshots.at(-1)?.message).toContain('physical load state is unknown');
    expect(f.writes).toHaveLength(4);
    await pilot.stop();
    expect(f.writes).toHaveLength(4);
  });
  it('stops on visibility loss and requires a new session to start again', async () => {
    const f = fixture(),
      pilot = await f.prepare();
    await pilot.start();
    expect(() => pilot.setTarget(101)).toThrow('50–100');
    f.document.hidden = true;
    f.document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.writes.at(-1)).toEqual([8, 1]);
    expect(f.disconnect).not.toHaveBeenCalled();
    f.document.hidden = false;
    await pilot.start();
    expect(f.writes).toHaveLength(4);
  });
});
