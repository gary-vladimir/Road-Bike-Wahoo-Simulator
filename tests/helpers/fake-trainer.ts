import { vi } from 'vitest';
import {
  TrainerSession,
  setControlGate,
  type SessionOptions,
  type SessionSnapshot,
} from '../../src/trainer/session';

/** Synthetic FTMS trainer: records every control write and acknowledges it like a KICKR. */
export function fakeTrainer() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', doc);
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
  const trainer = {
    power: 120,
    cadence: 85,
    stale: false,
    silent: false,
    reject: undefined as number | undefined,
  };
  const point = Object.assign(new EventTarget(), {
    properties: { write: true, indicate: true },
    value: undefined as DataView | undefined,
    startNotifications: vi.fn(async () => point),
    writeValueWithResponse: async (bytes: ArrayBuffer) => {
      const payload = Array.from(new Uint8Array(bytes));
      writes.push(payload);
      if (trainer.silent) return;
      point.value = new DataView(
        Uint8Array.of(0x80, payload[0], trainer.reject === payload[0] ? 4 : 1).buffer,
      );
      point.dispatchEvent(new Event('characteristicvaluechanged'));
    },
  });
  const status = Object.assign(new EventTarget(), {
    value: undefined as DataView | undefined,
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
    telemetry: () => {
      const now = performance.now();
      return {
        power: trainer.power,
        cadence: trainer.cadence,
        receivedAt: now,
        powerAt: trainer.stale ? now - 5000 : now,
        cadenceAt: now,
      };
    },
  };
  const snapshots: SessionSnapshot[] = [];
  return {
    source,
    trainer,
    writes,
    disconnect,
    doc,
    device,
    snapshots,
    latest: () => snapshots.at(-1)!,
    open: (options: SessionOptions, now?: () => number) =>
      TrainerSession.open(source, options, (s) => snapshots.push(s), now),
    status: (...bytes: number[]) => {
      status.value = new DataView(Uint8Array.from(bytes).buffer);
      status.dispatchEvent(new Event('characteristicvaluechanged'));
    },
  };
}
export const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);
export const simGrade = (bytes: number[]) =>
  new DataView(Uint8Array.from(bytes).buffer).getInt16(3, true) / 100;
export const grades = (writes: number[][]) => writes.filter((w) => w[0] === 0x11).map(simGrade);
export const watts = (writes: number[][]) =>
  writes.filter((w) => w[0] === 5).map((w) => w[1] + w[2] * 256);

/** Fake timers that also drive performance.now(), plus the Settings control switch turned on. */
export function useTrainerClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
  });
  setControlGate(() => true);
}
export function resetTrainerClock() {
  setControlGate(() => false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
