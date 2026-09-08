import { test, expect } from '@playwright/test';
test('SIM is the default, routes have elevation profiles, and ERG workouts remain separate', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ride at your own pace.' })).toBeVisible();
  await expect(page.locator('.route-grid .workout-card')).toHaveCount(3);
  await page.getByRole('button', { name: /Rolling foothills Six kilometers/ }).click();
  await expect(page.locator('.workout-detail h2')).toHaveText('Rolling foothills');
  await expect(
    page.getByText('Automatic terrain resistance is awaiting hardware validation.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/terrain-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.getByText('ERG · STRUCTURED POWER WORKOUTS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start demo ride' })).toBeAttached();
});
test('free road demo has effort/coasting controls, no FTP target, and saves SIM history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start road demo', exact: true }).click();
  await expect(page.locator('.countdown-number')).not.toBeVisible({ timeout: 18000 });
  await expect(page.getByText('Your effort · no watt target', { exact: true })).toBeVisible();
  await expect(page.getByText('Your cadence · shift freely', { exact: true })).toBeVisible();
  const slider = page.getByRole('slider', { name: 'Demo effort watts' });
  await slider.focus();
  await slider.press('End');
  await expect(page.locator('.demo-effort span')).toHaveText('400 W');
  await page.getByRole('button', { name: 'Coast', exact: true }).click();
  await expect(page.locator('.demo-effort span')).toHaveText('0 W');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(
    page.getByText('SIM terrain preview · free pacing · no resistance commands', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ride history', exact: true }).click();
  await expect(page.locator('.history-item')).toContainText('SIM');
  await page.reload();
  await page.getByRole('button', { name: 'Ride history', exact: true }).click();
  await expect(page.locator('.history-item')).toContainText('Valley warm-up');
});
test('road selection stays usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ride at your own pace.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start road demo', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Start road demo', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/terrain-mobile.png', fullPage: true });
});
