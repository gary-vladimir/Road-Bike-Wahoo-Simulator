import { test, expect } from '@playwright/test';
import { waitForInitialRide } from '../helpers/ride-ready';

test('road library: selecting a road updates the hero; previews are local images', async ({
  page,
  request,
}) => {
  await page.goto('/');
  // Real Oaxaca roads come first; Monte Albán leads.
  await expect(page.locator('.hero-title')).toHaveText('Monte Albán');
  await expect(page.getByRole('img', { name: 'Map of Monte Albán' })).toBeVisible();
  await expect(page.getByText(/OpenStreetMap contributors/)).toBeVisible();
  await expect(page.locator('.route-card')).toHaveCount(8);
  await page.locator('.route-card', { hasText: 'Rolling foothills' }).click();
  await expect(page.locator('.hero-title')).toHaveText('Rolling foothills');
  await expect(page.locator('.hero-img')).toHaveAttribute('src', '/scenes/foothills.jpg');
  // The home page renders no background WebGL scene.
  await expect(page.locator('canvas')).toHaveCount(0);
  for (const image of await page.locator('.route-card img').all()) {
    const response = await request.get((await image.getAttribute('src'))!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/jpeg');
  }
  await page.reload();
  await expect(page.locator('.hero-title')).toHaveText('Rolling foothills');
  await page.screenshot({ path: 'test-results/ride-home.png', fullPage: true });
});

test('demo road: effort, coasting downhill at zero watts, summary and history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Rider weight kg', { exact: true })).toHaveValue('70');
  await expect(page.getByLabel('Wheel circumference mm', { exact: true })).toHaveValue('2155');
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.locator('.route-card', { hasText: 'Descent to the valley' }).click();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await waitForInitialRide(page);
  const slider = page.getByRole('slider', { name: 'Demo effort watts' });
  await slider.focus();
  await slider.press('End');
  await expect(page.getByLabel('Trainer status')).toContainText('400 W effort');
  await page.getByRole('button', { name: 'Coast', exact: true }).click();
  await expect(page.getByLabel('Motion status')).toContainText('Coasting');
  await expect(page.getByLabel('Motion status')).toContainText('gaining speed');
  await expect(page.locator('.dock .metric').first()).toContainText('0W');
  // Gravity alone moves the rider down the −3% road.
  await expect
    .poll(() => page.locator('.dock-figure strong').first().innerText(), { timeout: 15000 })
    .not.toBe('0.00');
  await page.screenshot({ path: 'test-results/road-coasting.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Motion status')).toBeVisible();
  await page.screenshot({ path: 'test-results/road-coasting-mobile.png' });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(page.getByRole('heading', { name: 'Descent to the valley' })).toBeVisible();
  await expect(page.locator('.stat-grid')).toContainText('climbed');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.ride-row')).toContainText('Road ride');
});
