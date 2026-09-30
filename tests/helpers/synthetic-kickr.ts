import type { Page } from '@playwright/test';

/**
 * Replace navigator.bluetooth with a synthetic KICKR that streams Indoor Bike Data every 200 ms,
 * acknowledges every control write and records it in window.mockControlWrites. Tests steer it
 * through window.mockCadence, mockPower, mockFollowPower, mockHoldStop and mockDelayPrepare.
 */
export async function installSyntheticKickr(page: Page) {
  await page.addInitScript(() => {
    const writes: number[][] = [];
    Object.assign(window, { mockControlWrites: writes });
    Object.assign(window, { mockCadence: 80, mockPower: 50, mockDelayPrepare: false });
    const data = Object.assign(new EventTarget(), {
      uuid: 'indoor-bike-data',
      value: new DataView(Uint8Array.of(0x44, 0, 0, 0, 160, 0, 50, 0).buffer),
      startNotifications: async () => {
        setInterval(() => {
          data.value.setUint16(
            4,
            (window as unknown as { mockCadence: number }).mockCadence * 2,
            true,
          );
          data.value.setInt16(6, (window as unknown as { mockPower: number }).mockPower, true);
          data.dispatchEvent(new Event('characteristicvaluechanged'));
        }, 200);
        return data;
      },
    });
    const point = Object.assign(new EventTarget(), {
      uuid: 'fitness-machine-control-point',
      properties: { write: true, indicate: true },
      value: undefined as DataView | undefined,
      startNotifications: async () => point,
      writeValueWithResponse: async (bytes: ArrayBuffer) => {
        const command = Array.from(new Uint8Array(bytes));
        writes.push(command);
        if (command[0] === 5 && (window as unknown as { mockFollowPower: boolean }).mockFollowPower)
          (window as unknown as { mockPower: number }).mockPower = command[1] + 256 * command[2];
        if (command[0] === 8 && (window as unknown as { mockHoldStop: boolean }).mockHoldStop) {
          Object.assign(window, {
            mockAcknowledgeStop: () => {
              point.value = new DataView(Uint8Array.of(0x80, 8, 1).buffer);
              point.dispatchEvent(new Event('characteristicvaluechanged'));
            },
          });
          return;
        }
        point.value = new DataView(Uint8Array.of(0x80, command[0], 1).buffer);
        point.dispatchEvent(new Event('characteristicvaluechanged'));
      },
    });
    const status = Object.assign(new EventTarget(), {
      uuid: 'fitness-machine-status',
      startNotifications: async () => {
        if ((window as unknown as { mockDelayPrepare: boolean }).mockDelayPrepare)
          await new Promise((resolve) => setTimeout(resolve, 700));
        return status;
      },
    });
    const service = {
      getCharacteristics: async () => [data, point, status],
      getCharacteristic: async (id: number) => {
        if (id === 0x2acc)
          return {
            readValue: async () => new DataView(Uint8Array.of(2, 64, 0, 0, 8, 32, 0, 0).buffer),
          };
        if (id === 0x2ad8)
          return { readValue: async () => new DataView(Uint8Array.of(0, 0, 0xd0, 7, 1, 0).buffer) };
        if (id === 0x2ad2) return data;
        if (id === 0x2ad9) return point;
        if (id === 0x2ada) return status;
        throw new Error('Unexpected characteristic');
      },
    };
    const device = Object.assign(new EventTarget(), {
      name: 'KICKR SYNTHETIC',
      id: 'synthetic-trainer',
      gatt: {
        connected: false,
        connect: async () => {
          device.gatt.connected = true;
          return device.gatt;
        },
        getPrimaryService: async () => service,
        disconnect: () => {
          device.gatt.connected = false;
          device.dispatchEvent(new Event('gattserverdisconnected'));
        },
      },
    });
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        requestDevice: async () => {
          localStorage.setItem(
            'mockPairCalls',
            String(Number(localStorage.getItem('mockPairCalls') ?? 0) + 1),
          );
          return device;
        },
        getDevices: async () => (localStorage.getItem('mockPairCalls') ? [device] : []),
      },
    });
  });
}

export const controlWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites);
