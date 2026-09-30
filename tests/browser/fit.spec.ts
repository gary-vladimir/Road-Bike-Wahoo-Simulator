import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Decoder, Stream } from '@garmin/fitsdk';
import { exportSession } from '../fixtures/export-session';
import { defaults } from '../../src/storage/store';
import { waitForInitialRide } from '../helpers/ride-ready';

async function readFit(download: Download) {
  const path = await download.path();
  if (!path) throw new Error('FIT download was not saved');
  const bytes = await readFile(path);
  const decoder = new Decoder(Stream.fromBuffer(bytes));
  expect(decoder.checkIntegrity()).toBe(true);
  const result = decoder.read();
  expect(result.errors).toEqual([]);
  return { bytes, messages: result.messages };
}
async function importRide(page: Page, s = exportSession()) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Import backup file').setInputFiles({
    name: 'bikesim-test-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ version: 1, settings: defaults, workouts: [], sessions: [s] }),
    ),
  });
  await expect(page.getByRole('status')).toContainText('Backup imported.');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('.ride-row-main').click();
}

test('saved live ride downloads valid FIT with coasting and pauses, without uploading', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('strava.com')) requests.push(request.url());
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await importRide(page);
  await expect(page.getByRole('link', { name: 'Open Strava file upload' })).toHaveAttribute(
    'href',
    'https://www.strava.com/upload/select',
  );
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download FIT for Strava' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^bikesim-2026-09-11-.*\.fit$/);
  const { bytes, messages: m } = await readFit(download);
  expect(m.sessionMesgs?.[0]).toMatchObject({
    totalTimerTime: 10,
    totalElapsedTime: 20,
    totalDistance: 30,
  });
  expect(m.recordMesgs?.filter((r) => r.power === 0)).toHaveLength(2);
  expect(m.sessionMesgs?.[0].subSport).toBe('indoorCycling');
  expect(m.workoutMesgs?.[0].wktName).toBe('BikeSIM - Valley coast & climb');
  await page.getByText('Title and description for Strava', { exact: true }).click();
  await expect(page.getByLabel('Activity title', { exact: true })).toHaveValue(
    'BikeSIM - Valley coast & climb',
  );
  await expect(page.getByLabel('Activity description', { exact: true })).toHaveValue(
    /0.03 km virtual distance/,
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy title', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'BikeSIM - Valley coast & climb',
  );
  await page.getByRole('button', { name: 'Copy description', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Indoor cycling in BikeSIM.',
  );
  expect(m.eventMesgs?.map((e) => e.eventType)).toEqual(['start', 'stopAll', 'start', 'stopAll']);
  await page.screenshot({ path: 'test-results/fit-summary-desktop.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.locator('.ride-row-main').click();
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download FIT for Strava' }).click();
  expect((await readFit(await again)).bytes).toEqual(bytes);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('Title and description for Strava', { exact: true }).click();
  await expect(page.getByLabel('Activity description', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Download FIT for Strava' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Download FIT for Strava' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/fit-summary-mobile.png', fullPage: true });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test('newly finished demo downloads an explicitly labeled FIT from its summary', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Graphics quality').selectOption('low');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await page.getByRole('button', { name: 'Ride', exact: true }).click();
  await page.getByRole('button', { name: 'Start ride' }).click();
  await waitForInitialRide(page);
  // The HUD clock shows whole elapsed seconds; 0:03 establishes at least three recorded seconds.
  await expect(page.locator('.dock-figure strong').nth(1)).toHaveText('0:03', { timeout: 6000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Finish & save ride' }).click();
  await expect(
    page.getByText('Demo ride: the file holds simulated data', { exact: false }),
  ).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download FIT for Strava' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain('DEMO');
  const { messages: m } = await readFit(download);
  expect(m.sessionMesgs?.[0].totalTimerTime).toBeGreaterThanOrEqual(2);
  expect(m.recordMesgs?.length).toBeGreaterThan(1);
  expect(m.fileIdMesgs?.[0].productName).toBe('DEMO - BikeSIM');
});

test('empty saved rides explain why FIT is unavailable and retain JSON export', async ({
  page,
}) => {
  const s = exportSession();
  s.samples = [];
  s.elapsed = 0;
  s.distance = 0;
  s.timerEvents = [];
  await importRide(page, s);
  await expect(page.getByRole('button', { name: 'Download FIT for Strava' })).toBeDisabled();
  await expect(
    page.getByText('Record at least one second of riding before exporting a FIT activity.'),
  ).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.json$/);
});
