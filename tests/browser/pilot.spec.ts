import { test, expect } from '@playwright/test';

test('supervised pilot requires readiness and stops acknowledged mock hardware', async ({
  page,
}) => {
  test.skip(process.env.VITE_TRAINER_CONTROL !== 'pilot', 'Requires the opt-in pilot server');
  await page.addInitScript(() => {
    const writes: number[][] = [];
    Object.assign(window, { mockControlWrites: writes });
    const data = Object.assign(new EventTarget(), {
      uuid: 'indoor-bike-data',
      value: new DataView(Uint8Array.of(0x44, 0, 0, 0, 160, 0, 50, 0).buffer),
      startNotifications: async () => {
        setInterval(() => data.dispatchEvent(new Event('characteristicvaluechanged')), 200);
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
        point.value = new DataView(Uint8Array.of(0x80, command[0], 1).buffer);
        point.dispatchEvent(new Event('characteristicvaluechanged'));
      },
    });
    const status = Object.assign(new EventTarget(), {
      uuid: 'fitness-machine-status',
      startNotifications: async () => status,
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
      value: { requestDevice: async () => device },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start 50 W test', exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await start.click();
  await expect(
    page.getByText('running · last acknowledged target 50 W', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '75 W', exact: true }).click();
  await expect(
    page.getByText('running · last acknowledged target 75 W', { exact: true }),
  ).toBeVisible({ timeout: 6000 });
  await page.getByRole('button', { name: 'Stop trainer test', exact: true }).click();
  await expect(
    page.getByText('Stop acknowledged. Physical unloading still requires hardware validation.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([[0], [5, 50, 0], [7], [5, 60, 0], [5, 70, 0], [5, 75, 0], [8, 1]]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export control test log' }).click();
  expect((await download).suggestedFilename()).toBe('bikesim-control-test.json');
  await expect(start).toBeDisabled();
});
