import { test, expect } from '@playwright/test';
test('library, custom workout, persistence and validation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Find your next ride.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/library-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Hills', exact: true }).click();
  await expect(page.locator('.workout-card')).toHaveCount(1);
  await page.locator('.workout-card').click();
  await page.getByRole('button', { name: 'Customize workout' }).click();
  await page.getByLabel('Workout name').fill('My test foothills');
  await page.getByLabel('Interval 1 seconds', { exact: true }).fill('45');
  await page.getByRole('button', { name: 'Save custom workout' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'My workouts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My test foothills' })).toBeVisible();
  await page.getByLabel('Ride source').selectOption('bluetooth');
  await page.getByRole('button', { name: 'Start live-power ride' }).click();
  await expect(page.getByRole('alert')).toContainText('Pair your KICKR');
  expect(errors).toEqual([]);
});
test('demo ride countdown, pause, resume, stop, summary and history', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await page.getByRole('button', { name: 'Start demo ride' }).click();
  await expect(page.locator('.countdown-number')).toBeVisible();
  await expect(page.getByText('YOUR ROAD IS READY', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume ride' }).click();
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 6000 });
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ride history', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Ride history', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(1);
});
test('settings, backup download and no automatic Bluetooth pairing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('FTP watts').fill('215');
  await page.getByLabel('Rider weight kg').fill('72');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  expect((await downloaded).suggestedFilename()).toBe('bikesim-backup.json');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('FTP watts')).toHaveValue('215');
  await page.getByRole('button', { name: 'Trainer', exact: true }).click();
  await expect(
    page.getByText(
      process.env.VITE_TRAINER_CONTROL === 'pilot' ? 'Explicit test start required' : 'Disabled',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pair KICKR via Bluetooth' })).toBeVisible();
});
test('narrow screen retains workout controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start demo ride' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/library-mobile.png', fullPage: true });
});
