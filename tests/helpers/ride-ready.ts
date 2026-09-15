import { expect, type Page } from '@playwright/test';

export async function waitForInitialRide(page: Page) {
  const countdown = page.locator('.countdown-number');
  // Cold software WebGL compilation and texture decoding precede the ten-second
  // countdown. Keep a separate bound for preparation and for the actual countdown.
  await expect(countdown).toHaveText(/^\d+$/, { timeout: 20000 });
  await expect(countdown).not.toBeVisible({ timeout: 15000 });
}
