import { test, expect } from '@playwright/test';
import { waitForInitialRide } from '../helpers/ride-ready';

test('route previews load locally and follow selection without a background WebGL renderer', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('.route-hero')).toHaveAttribute('src', '/scenes/valley.jpg');
  await page.getByRole('button', { name: /The steady ascent A 5 km climb/ }).click();
  await expect(page.locator('.route-hero')).toHaveAttribute('src', '/scenes/ascent.jpg');
  await expect(page.locator('.road-library canvas')).toHaveCount(0);
  for (const image of await page.locator('.route-cover img').all()) {
    const response = await request.get((await image.getAttribute('src'))!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/jpeg');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.route-hero')
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
});

test('road focus keeps Pause and Stop reachable on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start road demo', exact: true }).click();
  await waitForInitialRide(page);
  await page.getByRole('button', { name: 'Focus on the road', exact: true }).click();
  await expect(page.locator('.ride-bottom > .terrain-profile')).not.toBeVisible();
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 850 });
    for (const name of ['Pause', 'Stop']) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await expect(page.locator('.power-metric')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Show ride details', exact: true }).click();
  await expect(page.locator('.ride-bottom > .terrain-profile')).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ride paused.' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish & save ride', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your ride, recorded.' })).toBeVisible();
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
