import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (e.type() === 'error' && /THREE|WebGL|shader/.test(e.text())) errors.push(e.text());
});
await fs.mkdir('test-results/visual', { recursive: true });
await fs.mkdir('public/scenes', { recursive: true });
for (const [route, distance] of [
  ['valley', 190],
  ['foothills', 1300],
  ['descent', 180],
  ['ascent', 2400],
]) {
  await page.goto(
    `http://localhost:5173/tests/visual/scene.html?route=${route}&distance=${distance}`,
  );
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `public/scenes/${route}.jpg`, quality: 88 });
}
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://localhost:5173/');
await page.getByRole('heading', { name: 'Ride at your own pace.' }).waitFor();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test-results/visual/library.png', fullPage: true });
await page.getByRole('button', { name: 'Settings', exact: true }).click();
await page.getByLabel('Graphics quality').selectOption('low');
await page.getByRole('button', { name: 'Save settings', exact: true }).click();
await page.getByRole('button', { name: 'Ride', exact: true }).click();
await page.getByRole('button', { name: 'Start road demo', exact: true }).click();
await page.locator('.countdown-number').waitFor({ state: 'hidden', timeout: 25000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: 'test-results/visual/ride.png' });
await page.getByRole('button', { name: 'Focus on the road', exact: true }).click();
await page.screenshot({ path: 'test-results/visual/focus.png' });
await page.getByRole('button', { name: 'Pause', exact: true }).click();
await page.getByRole('button', { name: 'Finish & save ride', exact: true }).click();
await page.getByRole('heading', { name: 'Your ride, recorded.' }).waitFor();
await page.screenshot({ path: 'test-results/visual/summary.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://localhost:5173/');
await page.getByRole('heading', { name: 'Ride at your own pace.' }).waitFor();
await page.screenshot({ path: 'test-results/visual/mobile.png', fullPage: true });
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  'Captured four scene previews, desktop library/ride/focus/summary, and mobile library; no renderer errors.',
);
await browser.close();
