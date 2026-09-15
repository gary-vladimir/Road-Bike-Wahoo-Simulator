import { test, expect } from '@playwright/test';
import { waitForInitialRide } from '../helpers/ride-ready';

test.beforeEach(async ({ page }) => {
  test.skip(process.env.VITE_TRAINER_CONTROL !== 'pilot', 'Requires the opt-in pilot server');
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
});
async function openControlledRoad(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByLabel('Ride source').selectOption('controlled');
}
const roadWrites = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites);
test('controlled road requires readiness, supports coasting, resumes explicitly and finishes after Stop', async ({
  page,
}) => {
  await openControlledRoad(page);
  const start = page.getByRole('button', { name: 'Start SIM road ride', exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole('checkbox', { name: /I’m ready for a SIM road ride/ }).check();
  await page.getByRole('button', { name: /Rolling foothills/ }).click();
  await expect(start).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('exceeds the tested');
  expect(await roadWrites(page)).toEqual([]);
  await page.getByRole('button', { name: /Valley warm-up/ }).click();
  await start.click();
  await expect(page.getByLabel('Trainer control status')).toContainText('Terrain control active');
  await waitForInitialRide(page);
  await expect(page.locator('.ride-time')).toContainText('0:02');
  await page.evaluate(() => Object.assign(window, { mockPower: 0, mockCadence: 0 }));
  await expect(page.getByLabel('Motion status')).toContainText(/Coasting|Stopped · pedal to move/);
  expect(await roadWrites(page)).toEqual([[0], [17, 0, 0, 0, 0, 40, 18], [7]]);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume ride' })).toBeEnabled();
  expect((await roadWrites(page)).at(-1)).toEqual([8, 1]);
  await page.getByRole('button', { name: 'Resume ride' }).click();
  await expect(page.getByLabel('Trainer control status')).toContainText('Terrain control active');
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 8000 });
  expect((await roadWrites(page)).slice(-3)).toEqual([[0], [17, 0, 0, 0, 0, 40, 18], [7]]);
  await page.screenshot({ path: 'test-results/controlled-road.png' });
  await page.evaluate(() => Object.assign(window, { mockHoldStop: true }));
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume ride' })).toBeDisabled();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).not.toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { mockAcknowledgeStop: () => void }).mockAcknowledgeStop(),
  );
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).toBeVisible();
  await expect(
    page.getByText('LIVE POWER SESSION · AUTOMATIC SIM TERRAIN', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download FIT for Strava' })).toBeEnabled();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download FIT for Strava' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.fit$/);
  expect((await roadWrites(page)).filter((w) => w[0] === 5)).toEqual([]);
  await page.reload();
  expect(await roadWrites(page)).toEqual([]);
});
test('controlled road cancellation during preparation never sends a late Start', async ({
  page,
}) => {
  await openControlledRoad(page);
  await page.evaluate(() => Object.assign(window, { mockDelayPrepare: true }));
  await page.getByRole('checkbox', { name: /I’m ready for a SIM road ride/ }).check();
  await page.getByRole('button', { name: 'Start SIM road ride', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel countdown' }).click();
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await roadWrites(page)).toEqual([]);
});
test('live SIM road preview runs without FTP and sends no resistance commands', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await expect(page.getByLabel('FTP watts')).toHaveValue('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByLabel('Ride source').selectOption('bluetooth');
  await page.getByRole('button', { name: 'Start live road preview', exact: true }).click();
  await waitForInitialRide(page);
  await expect(page.getByText('Your effort · no watt target', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
});
test('supervised pilot requires readiness and stops acknowledged mock hardware', async ({
  page,
}) => {
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
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await expect(start).toBeEnabled();
});
test('SIM hardware pilot permits coasting, uses only slope commands, and stops explicitly', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => Object.assign(window, { mockCadence: 0, mockPower: 0 }));
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'SIM · terrain test', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start flat SIM test', exact: true });
  await expect(start).toBeDisabled();
  await expect(page.getByText(/Falling below 50 rpm ends/)).not.toBeVisible();
  await page.getByRole('checkbox', { name: /I’m ready for SIM/ }).check();
  await start.click();
  await expect(
    page.getByText('running · last acknowledged slope 0%', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '1% slope', exact: true }).click();
  await expect(page.getByText('running · last acknowledged slope 1%', { exact: true })).toBeVisible(
    { timeout: 7000 },
  );
  await expect(page.getByRole('button', { name: 'ERG · power test', exact: true })).toBeDisabled();
  await page.screenshot({ path: 'test-results/sim-pilot.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop trainer test', exact: true }).click();
  await expect(
    page.getByText('stopped · last acknowledged slope 1%', { exact: true }),
  ).toBeVisible();
  const writes = await page.evaluate(
    () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
  );
  expect(writes).toEqual([
    [0],
    [17, 0, 0, 0, 0, 40, 18],
    [7],
    [17, 0, 0, 25, 0, 40, 18],
    [17, 0, 0, 50, 0, 40, 18],
    [17, 0, 0, 75, 0, 40, 18],
    [17, 0, 0, 100, 0, 40, 18],
    [8, 1],
  ]);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
});

test('shows measured power independently of accepted targets and preserves evidence across reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await page.getByRole('button', { name: 'Start 50 W test', exact: true }).click();
  await expect(
    page.getByText('running · last acknowledged target 50 W', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '100 W', exact: true }).click();
  await expect(page.getByRole('button', { name: '100 W', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByText('running · last acknowledged target 100 W', { exact: true }),
  ).toBeVisible({ timeout: 9000 });
  const measurements = page.getByLabel('ERG response measurements');
  await expect(measurements).toContainText('50measured W');
  await expect(page.getByRole('cell', { name: '50.0 W', exact: true })).toBeVisible({
    timeout: 14000,
  });
  await expect(page.getByRole('cell', { name: '80.0 rpm', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop trainer test', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export last saved test', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('bikesim');
          request.onsuccess = () => resolve(request.result);
        });
        return new Promise<string>((resolve) => {
          const read = db.transaction('settings').objectStore('settings').get('last-pilot-report');
          read.onsuccess = () => {
            db.close();
            resolve(read.result?.state);
          };
        });
      }),
    )
    .toBe('stopped');
  await page.screenshot({ path: 'test-results/pilot-evidence-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export last saved test', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 50 W test', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
});

test('zero-cadence Start waits, Stop cancels, and retry works without reconnecting', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => Object.assign(window, { mockCadence: 0 }));
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  const start = page.getByRole('button', { name: 'Start 50 W test', exact: true });
  const stop = page.getByRole('button', { name: 'Stop trainer test', exact: true });
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await start.click();
  await expect(
    page.getByText('waiting · no power target acknowledged', { exact: true }),
  ).toBeVisible();
  await expect(stop).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
  await stop.click();
  await expect(
    page.getByText('Test cancelled. No resistance commands were sent.', { exact: true }),
  ).toBeVisible();
  await expect(stop).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await start.click();
  await page.evaluate(() => Object.assign(window, { mockCadence: 80 }));
  await expect(
    page.getByText('running · last acknowledged target 50 W', { exact: true }),
  ).toBeVisible();
  await stop.click();
  await expect(
    page.getByText('stopped · last acknowledged target 50 W', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mockPairCalls'))).toBe('1');
});

test('refresh restores only telemetry; deliberate disconnect survives refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start 50 W test', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('mockPairCalls'))).toBe('1');
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pair KICKR via Bluetooth' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
});

test('Disconnect stops an active test before dropping Bluetooth and reconnect needs no chooser', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await page.getByRole('button', { name: 'Start 50 W test', exact: true }).click();
  await expect(
    page.getByText('running · last acknowledged target 50 W', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([[0], [5, 50, 0], [7], [8, 1]]);
  await page.getByRole('button', { name: 'Reconnect KICKR', exact: true }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mockPairCalls'))).toBe('1');
});

test('Stop cancels pending preparation before any control command can start', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => Object.assign(window, { mockDelayPrepare: true }));
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await page.getByRole('button', { name: 'Pair KICKR via Bluetooth' }).click();
  await expect(page.getByText('Live power received', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I’m on the bike and ready' }).check();
  await page.getByRole('button', { name: 'Start 50 W test', exact: true }).click();
  await page.getByRole('button', { name: 'Stop trainer test', exact: true }).click();
  await expect(
    page.getByText('Test cancelled. No resistance commands were sent.', { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(900);
  expect(
    await page.evaluate(
      () => (window as unknown as { mockControlWrites: number[][] }).mockControlWrites,
    ),
  ).toEqual([]);
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
});
