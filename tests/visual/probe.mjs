// Headless scene probe: screenshots the capture harness and times tile streaming.
// Run inside the devcontainer with the dev server up: node tests/visual/probe.mjs [route] [meters]
import { chromium } from '@playwright/test';
const [route = 'foothills', distance = '1300'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(
  `http://localhost:5173/tests/visual/scene.html?route=${route}&distance=${distance}`,
);
await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
await page.screenshot({ path: `test-results/visual/probe-${route}-${distance}.jpg`, quality: 85 });
const result = await page.evaluate(() => {
  const w = window.__bikesimScene;
  const cam = w.camera.position;
  const rows = [];
  for (let k = 1; k <= 3; k++) {
    const t = performance.now();
    w.tiles.update(cam.x, cam.z - 256 * k, Infinity);
    rows.push(Math.round(performance.now() - t));
  }
  return { tileRowsMs: rows, instances: w.props.group.children.map((m) => m.count) };
});
console.log(JSON.stringify({ ...result, errors }));
await browser.close();
