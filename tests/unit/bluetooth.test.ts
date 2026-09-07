import { afterEach, describe, expect, it, vi } from 'vitest';
import { BluetoothTrainer } from '../../src/trainer/bluetooth';
afterEach(() => vi.unstubAllGlobals());
describe('read-only trainer boundary', () => {
  it('reports unavailable Bluetooth without throwing or fabricating readings', async () => {
    vi.stubGlobal('navigator', {});
    const t = new BluetoothTrainer();
    await t.connect();
    expect(t.snapshot.status).toBe('error');
    expect(t.snapshot.telemetry.power).toBeUndefined();
  });
  it('reads FTMS and subscribes without accessing the control point', async () => {
    const features = new DataView(Uint8Array.from([2, 64, 0, 0, 8, 32, 0, 0]).buffer);
    const range = new DataView(Uint8Array.from([0, 0, 200, 0, 1, 0]).buffer);
    const notification = Object.assign(new EventTarget(), {
      uuid: 'indoor-bike-data',
      startNotifications: vi.fn(async () => {}),
      value: new DataView(Uint8Array.from([0x44, 0, 0xb8, 0xb, 180, 0, 120, 0]).buffer),
    });
    const getCharacteristic = vi.fn(async (id: number) => {
      if (id === 0x2acc) return { readValue: async () => features };
      if (id === 0x2ad8) return { readValue: async () => range };
      if (id === 0x2ad2) return notification;
      throw new Error('Unexpected characteristic access');
    });
    const service = { getCharacteristics: async () => [notification], getCharacteristic };
    const disconnect = vi.fn();
    const device = Object.assign(new EventTarget(), {
      name: 'KICKR TEST',
      gatt: { connect: async () => ({ getPrimaryService: async () => service }), disconnect },
    });
    const requestDevice = vi.fn(async () => device);
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    const t = new BluetoothTrainer();
    await t.connect();
    expect(t.snapshot.status).toBe('connected');
    expect(getCharacteristic.mock.calls.map((c) => c[0])).toEqual([0x2acc, 0x2ad8, 0x2ad2]);
    notification.dispatchEvent(new Event('characteristicvaluechanged'));
    expect(t.snapshot.telemetry).toMatchObject({ power: 120, cadence: 90, speed: 30 });
    await t.connect();
    expect(requestDevice).toHaveBeenCalledTimes(1);
    t.disconnect();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(t.snapshot.telemetry.power).toBeUndefined();
  });
  it('cleans up a partially connected device after service discovery fails', async () => {
    const disconnect = vi.fn();
    const device = Object.assign(new EventTarget(), {
      name: 'KICKR TEST',
      gatt: {
        connect: async () => ({
          getPrimaryService: async () => {
            throw new Error('FTMS missing');
          },
        }),
        disconnect,
      },
    });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
    const t = new BluetoothTrainer();
    await t.connect();
    expect(t.snapshot.status).toBe('error');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(t.snapshot.telemetry.power).toBeUndefined();
  });
});
