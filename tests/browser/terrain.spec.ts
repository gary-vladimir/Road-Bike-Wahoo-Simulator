import { test, expect } from '@playwright/test';
import { waitForInitialRide } from '../helpers/ride-ready';
test('SIM is the default, routes have elevation profiles, and ERG workouts remain separate', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ride at your own pace.' })).toBeVisible();
  await expect(page.locator('.route-grid .workout-card')).toHaveCount(4);
  await page.getByRole('button', { name: /Rolling foothills Six kilometers/ }).click();
  await expect(page.locator('.workout-detail h2')).toHaveText('Rolling foothills');
  await expect(
    page.getByText('Demo and live previews never change trainer load.', {
      exact: true,
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
  await waitForInitialRide(page);
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
test('confirmed profile is editable and the downhill demo coasts at zero watts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Rider weight kg', { exact: true })).toHaveValue('70');
  await expect(page.getByLabel('Wheel diameter', { exact: true })).toHaveValue('622');
  await expect(page.getByLabel('Tire width mm', { exact: true })).toHaveValue('32');
  await expect(page.getByLabel('Wheel circumference mm', { exact: true })).toHaveValue('2155');
  await page.getByLabel('Wheel circumference mm', { exact: true }).fill('2160');
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Wheel circumference mm', { exact: true })).toHaveValue('2160');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: /Descent to the valley A 2 km downhill/ }).click();
  await page.getByRole('button', { name: 'Start road demo', exact: true }).click();
  await waitForInitialRide(page);
  await page.getByRole('button', { name: 'Coast', exact: true }).click();
  await expect(page.getByLabel('Motion status')).toContainText('Coasting · 0 W');
  await expect(page.getByLabel('Motion status')).toContainText('Gaining speed');
  await expect(page.getByLabel('Motion status')).toContainText(
    'Gravity exceeds rolling and air drag.',
  );
  const distance = () => page.locator('.ride-metrics').innerText();
  // The display rounds to 10 m; gravity needs more than five seconds to cross 5 m from rest.
  await expect.poll(distance, { timeout: 15000 }).not.toContain('0.00 km ridden');
  await expect(page.locator('.power-metric strong')).toHaveText('0W');
  await page.screenshot({ path: 'test-results/downhill-coasting.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.coasting-trend')).toBeVisible();
  await expect(page.locator('.coasting-trend')).toHaveText('Gaining speed');
  await page.screenshot({ path: 'test-results/downhill-coasting-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).toBeVisible();
});
