import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErgPilot, type PilotSnapshot } from '../../src/trainer/pilot';

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
    cadence = 80,
    stale = false;
  const point = Object.assign(new EventTarget(), {
    properties: { write: true, indicate: true },
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => point),
    writeValueWithResponse: async (bytes: ArrayBuffer) => {
      const payload = Array.from(new Uint8Array(bytes));
      writes.push(payload);
      if ((payload[0] !== 8 || !delayStop) && (payload[0] !== 5 || !delayPower)) ack(payload[0]);
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
      power: 50,
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
    prepare: () => ErgPilot.prepare(source, (s) => snapshots.push(s)),
    delayStop: () => {
      delayStop = true;
    },
    delayPower: () => {
      delayPower = true;
    },
    stall: () => {
      cadence = 0;
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
describe('supervised pilot lifecycle with synthetic GATT only', () => {
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
    expect(f.disconnect).toHaveBeenCalledTimes(1);
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
    expect(f.disconnect).toHaveBeenCalledTimes(1);
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
    expect(f.disconnect).toHaveBeenCalledTimes(1);
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
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    f.document.hidden = false;
    await pilot.start();
    expect(f.writes).toHaveLength(4);
  });
});
