import { test, expect, type Page } from '@playwright/test';
import { waitForInitialRide } from '../helpers/ride-ready';

async function lowGraphics(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
}

test('workout library filters, customizes, persists and deletes a workout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hills', exact: true }).click();
  await expect(page.locator('.workout-card')).toHaveCount(2);
  await page.locator('.workout-card', { hasText: 'Into the foothills' }).click();
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByLabel('Workout name').fill('My test foothills');
  await page.getByLabel('Interval 1 seconds', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Save custom workout' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'My workouts', exact: true }).click();
  await page.locator('.workout-card', { hasText: 'My test foothills' }).click();
  await expect(page.locator('.detail h2')).toHaveText('My test foothills');
  // Live power needs a paired trainer: the start button explains instead of failing.
  await page.getByRole('radio', { name: 'Live power' }).click();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeDisabled();
  await expect(page.locator('.detail .notice')).toContainText('Pair your KICKR');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByRole('button', { name: 'My workouts', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workouts-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('demo workout: countdown, pause, resume, keyboard pause, summary and history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await lowGraphics(page);
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.locator('.workout-card', { hasText: 'First five minutes' }).click();
  await page.getByRole('button', { name: 'Start workout' }).click();
  await expect(page.getByText('Your road is ready', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 15000 });
  await expect(page.locator('.dock')).toContainText('Target');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume ride' }).click();
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 6000 });
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('group', { name: 'Workout intensity' })).toContainText('105%');
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'First five minutes' })).toBeVisible();
  await expect(
    page.getByText('Demo ride: these numbers come from the simulated rider.'),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/summary-workout.png', fullPage: true });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.ride-row')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.ride-row')).toContainText('First five minutes');
});

test('settings persist, back up, and leave trainer control off until switched on', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('FTP watts').fill('215');
  await page.getByLabel('Rider weight kg').fill('72');
  await page.getByLabel('Riding position').selectOption('aero');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  expect((await downloaded).suggestedFilename()).toBe('bikesim-backup.json');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('FTP watts')).toHaveValue('215');
  await expect(page.getByLabel('Riding position')).toHaveValue('aero');
  await expect(
    page.getByRole('switch', { name: 'Let BikeSIM control my KICKR' }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Trainer sets the slope' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Trainer connection' }).click();
  await expect(page.getByRole('button', { name: 'Off · turn on in Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair KICKR via Bluetooth' })).toBeVisible();
});

test('narrow screens keep the main actions reachable without sideways scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeVisible();
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'Start workout' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Start workout' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workouts-mobile.png', fullPage: true });
});

test('the development server refuses the local generation credential file', async ({ request }) => {
  // Deliberately do not inspect or print the response body.
  for (const path of [
    '/token.txt',
    '/token.txt?raw',
    '/%74oken.txt',
    '/@fs/workspace/token.txt',
    '/.secrets/example',
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(403);
  }
});

test('a road demo shows the ride dock and focus mode keeps Pause reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.goto('/');
  await lowGraphics(page);
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await waitForInitialRide(page);
  await expect(page.locator('.dock')).toContainText('Grade');
  await page.getByRole('button', { name: 'Focus on the road', exact: true }).click();
  await expect(page.locator('.dock-track')).not.toBeVisible();
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport();
  }
  await page.getByRole('button', { name: 'Show ride details', exact: true }).click();
  await expect(page.locator('.dock-track')).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Valley warm-up' })).toBeVisible();
});
