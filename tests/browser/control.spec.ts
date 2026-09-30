import { test, expect } from '@playwright/test';
import {
  controlWrites,
  ergWatts,
  installSyntheticKickr,
  pairWithControl,
  simGrades,
} from '../helpers/synthetic-kickr';

const flat = [0x11, 0, 0, 0, 0, 40, 16];

test.beforeEach(async ({ page }) => {
  await installSyntheticKickr(page);
  await page.setViewportSize({ width: 1100, height: 850 });
});

test('trainer-controlled road: flat start, follows the descent, pauses flat, ends without Stop', async ({
  page,
}) => {
  test.setTimeout(90000);
  await pairWithControl(page);
  await page.evaluate(() => Object.assign(window, { mockPower: 180, mockCadence: 85 }));
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.locator('.route-card', { hasText: 'Descent to the valley' }).click();
  await page.getByRole('radio', { name: 'Trainer sets the slope' }).click();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await expect.poll(() => controlWrites(page), { timeout: 20000 }).toEqual([[0], flat, [7]]);
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 20000 });
  // The road starts at −3%: the trainer follows in half-point steps.
  await expect
    .poll(async () => simGrades(await controlWrites(page)).at(-1), { timeout: 10000 })
    .toBe(-3);
  expect(simGrades(await controlWrites(page)).slice(0, 4)).toEqual([0, -0.5, -1, -1.5]);
  await expect(page.getByLabel('Trainer status')).toContainText('trainer slope -3.0%');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await controlWrites(page)).at(-1)).toEqual(flat);
  await expect(page.getByText('The trainer is holding a flat road.')).toBeVisible();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Descent to the valley' })).toBeVisible();
  const writes = await controlWrites(page);
  expect(writes.at(-1)).toEqual(flat);
  // FTMS Stop would hand the KICKR back to its heavier default load.
  expect(writes.some((w) => w[0] === 8)).toBe(false);
  // Telemetry stays connected after the ride.
  await expect(page.getByRole('button', { name: 'Trainer connection' })).toContainText('W');
});

test('trainer-held workout: 50 W start, targets, low-cadence recovery, flat finish', async ({
  page,
}) => {
  test.setTimeout(90000);
  await pairWithControl(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('FTP watts').fill('200');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.evaluate(() => Object.assign(window, { mockFollowPower: true, mockCadence: 88 }));
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.locator('.workout-card', { hasText: 'First five minutes' }).click();
  await page.getByRole('radio', { name: 'Trainer holds the watts' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect.poll(() => controlWrites(page), { timeout: 20000 }).toEqual([[0], [5, 50, 0], [7]]);
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 20000 });
  await expect
    .poll(async () => ergWatts(await controlWrites(page)).at(-1), { timeout: 10000 })
    .toBeGreaterThanOrEqual(80);
  // A two-second 0 rpm glitch changes nothing…
  const before = (await controlWrites(page)).length;
  await page.evaluate(() => Object.assign(window, { mockCadence: 0 }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => Object.assign(window, { mockCadence: 88 }));
  await page.waitForTimeout(1500);
  expect(ergWatts((await controlWrites(page)).slice(before))).not.toContain(50);
  // …but sustained low cadence eases to 50 W, and spinning up brings the target back.
  await page.evaluate(() => Object.assign(window, { mockCadence: 30 }));
  await expect(page.getByLabel('Trainer status')).toContainText('Easing to 50 W', {
    timeout: 8000,
  });
  expect(ergWatts(await controlWrites(page)).at(-1)).toBe(50);
  await page.evaluate(() => Object.assign(window, { mockCadence: 88 }));
  await expect(page.getByLabel('Trainer status')).toContainText('holding', { timeout: 8000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => ergWatts(await controlWrites(page)).at(-1)).toBe(50);
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'First five minutes' })).toBeVisible();
  const writes = await controlWrites(page);
  expect(writes.at(-1)).toEqual(flat);
  expect(writes.some((w) => w[0] === 8)).toBe(false);
});

test('manual trainer check can end on a flat road or send FTMS Stop', async ({ page }) => {
  await pairWithControl(page);
  await page.getByText('Manual trainer check', { exact: true }).click();
  await page.getByRole('button', { name: 'Start on a flat road' }).click();
  await expect.poll(() => controlWrites(page), { timeout: 10000 }).toEqual([[0], flat, [7]]);
  await page.getByRole('button', { name: '1%', exact: true }).click();
  await expect
    .poll(async () => simGrades(await controlWrites(page)).at(-1), { timeout: 6000 })
    .toBe(1);
  await page.getByRole('button', { name: 'Send FTMS Stop' }).click();
  await expect.poll(async () => (await controlWrites(page)).at(-1)).toEqual([8, 1]);
  await expect(page.getByText(/Stop acknowledged/)).toBeVisible();
});

test('without the Settings switch no controlled source is offered', async ({ page }) => {
  await pairWithControl(page, false);
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Live power' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Trainer sets the slope' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Live power' }).click();
  await expect(page.getByText(/Turn on trainer control in/)).toBeVisible();
  expect(await controlWrites(page)).toEqual([]);
});

test('FTP ramp: automatic result from measured power, saved to Settings', async ({ page }) => {
  test.setTimeout(120000);
  await page.clock.install();
  await pairWithControl(page);
  await page.evaluate(() => Object.assign(window, { mockFollowPower: true, mockCadence: 88 }));
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'Take the ramp test' }).click();
  await expect(page.getByRole('heading', { name: 'Find your FTP.' })).toBeVisible();
  await page.getByLabel('FTP test protocol').selectOption('gentle');
  await page.getByRole('button', { name: 'Start FTP test' }).click();
  await expect.poll(() => controlWrites(page), { timeout: 10000 }).toEqual([[0], [5, 50, 0], [7]]);
  // Warm-up, then eight ramp minutes.
  for (let i = 0; i < 13; i++) await page.clock.runFor(60000);
  await expect(page.getByText('RAMP · ONE MINUTE AT A TIME')).toBeVisible();
  // The rider can no longer turn the pedals over: the test ends by itself.
  await page.evaluate(() => Object.assign(window, { mockCadence: 20 }));
  await page.clock.runFor(8000);
  await expect(page.getByRole('heading', { name: /Estimated FTP: \d+ W/ })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('The trainer is on a flat road.')).toBeVisible();
  const writes = await controlWrites(page);
  expect(writes.at(-1)).toEqual(flat);
  expect(writes.some((w) => w[0] === 8)).toBe(false);
  const ftp = Number(
    (await page.getByRole('heading', { name: /Estimated FTP/ }).innerText()).match(/\d+/)![0],
  );
  await page.getByRole('button', { name: 'Back to BikeSIM' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('FTP watts')).toHaveValue(String(ftp));
});
