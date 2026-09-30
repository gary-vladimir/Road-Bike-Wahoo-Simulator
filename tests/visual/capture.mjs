// Captures the app for visual review, and optionally refreshes the road preview images.
// Inside the devcontainer, with the dev server running:
//   node tests/visual/capture.mjs            → test-results/visual/*.png
//   node tests/visual/capture.mjs --previews → also rewrites public/scenes/<road>.jpg
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const base = 'http://localhost:5173';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (e.type() === 'error' && /THREE|WebGL|shader/.test(e.text())) errors.push(e.text());
});
await fs.mkdir('test-results/visual', { recursive: true });

if (process.argv.includes('--previews')) {
  const preview = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  for (const [route, distance] of [
    ['monte-alban', 9600],
    ['san-felipe', 4200],
    ['tule-mitla', 9000],
    ['teotitlan', 2600],
    ['valley', 190],
    ['foothills', 1300],
    ['descent', 180],
    ['ascent', 2400],
  ]) {
    await preview.goto(`${base}/tests/visual/scene.html?route=${route}&distance=${distance}`);
    await preview.waitForSelector('body[data-ready="true"]', { timeout: 120000 });
    await preview.screenshot({ path: `public/scenes/${route}.jpg`, quality: 84, timeout: 120000 });
  }
  await preview.close();
}

const shot = (name) => page.screenshot({ path: `test-results/visual/${name}.png` });
await page.goto(base);
await page.locator('.hero-title').waitFor();
await shot('home');
await page.getByRole('button', { name: 'Workouts', exact: true }).click();
await shot('workouts');
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.getByLabel('Graphics quality').selectOption('low');
await page.getByRole('button', { name: 'Save settings' }).click();
await shot('settings');

// A workout: the generated road rises into the hard intervals.
await page.getByRole('button', { name: 'Workouts', exact: true }).click();
await page.locator('.workout-card', { hasText: 'Into the foothills' }).click();
await page.getByRole('button', { name: 'Start workout' }).click();
await page.locator('.countdown-number').waitFor({ state: 'hidden', timeout: 40000 });
await page.waitForTimeout(1500);
await shot('ride-workout');
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await shot('ride-paused');
await page.getByRole('button', { name: 'Finish & save ride' }).click();
await page.locator('.stat-grid').waitFor();
await shot('summary');

// A road ride on the climb.
await page.getByRole('button', { name: 'Ride', exact: true }).click();
await page.locator('.route-card', { hasText: 'The steady ascent' }).click();
await page.getByRole('button', { name: 'Start ride' }).click();
await page.locator('.countdown-number').waitFor({ state: 'hidden', timeout: 40000 });
await page.waitForTimeout(1500);
await shot('ride-road');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await shot('ride-road-mobile');
await page.setViewportSize({ width: 1440, height: 900 });
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.getByRole('button', { name: 'Finish & save ride' }).click();
await page.locator('.stat-grid').waitFor();
await page.getByRole('button', { name: 'History', exact: true }).click();
await shot('history');

if (errors.length) throw new Error(errors.join('\n'));
console.log('Captured home, workouts, settings, rides, summary and history; no renderer errors.');
await browser.close();
