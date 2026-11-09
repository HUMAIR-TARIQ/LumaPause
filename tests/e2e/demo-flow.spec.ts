import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForCalibrationReady } from './helpers';

test('runs the full simulated journey and clears the session', async () => {
  const { app, page } = await launchApp({ key: null, timingScale: 0.1 });
  try {
    await expect(page.getByRole('heading', { name: 'LumaPause' })).toBeVisible();
    await page.getByRole('button', { name: 'Begin privately' }).click();
    await expect(
      page.getByRole('heading', { name: /live measurement needs a little setup/i }),
    ).toBeVisible();
    await expect(page.getByText('No API key detected')).toBeVisible();

    await page.getByRole('button', { name: 'Explore demo mode' }).click();
    await expect(page.getByRole('heading', { name: /choose a simulated scenario/i })).toBeVisible();
    await expect(page.getByText(/SIMULATED SIGNALS|Not SmartSpectra data/).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: /stable signals/i })).toBeChecked();

    await page.getByRole('button', { name: 'Enter demo room' }).click();
    await expect(page.getByRole('heading', { name: /learn your rhythm/i })).toBeVisible();
    await expect(page.getByText(/SIMULATED SIGNALS — NOT SMARTSPECTRA DATA/)).toBeVisible();

    await waitForCalibrationReady(page);
    await page.getByRole('button', { name: 'Continue to the room' }).click();
    await expect(page.getByRole('heading', { name: /two quiet minutes/i })).toBeVisible();

    await page.getByRole('button', { name: 'Enter the room' }).click();
    await expect(page.getByRole('heading', { name: 'Arrive', exact: true })).toBeVisible();
    await expect(page.locator('.room__brand')).toBeVisible();
    await expect(page.getByText('Simulated · camera off')).toBeVisible();
    await expect(page.getByText('Simulated breathing and pulse')).toBeVisible({
      timeout: 15_000,
    });

    // The developer overlay is opt-in and keyboard-only.
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('aside[aria-label="Developer overlay"]')).toBeVisible();
    await expect(page.locator('aside[aria-label="Developer overlay"]')).toContainText(
      'SIMULATED — NOT SMARTSPECTRA DATA',
    );
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('aside[aria-label="Developer overlay"]')).toBeHidden();

    await expect(page.getByRole('heading', { name: 'Settle', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: 'Choose', exact: true })).toBeVisible({
      timeout: 25_000,
    });

    await page
      .getByPlaceholder('For example: speak slowly and look up between points.')
      .fill('Speak slowly and look up between points.');
    await expect(page.getByText('40/140 · kept in memory only')).toBeVisible();
    await page.getByRole('button', { name: 'Complete the room' }).click();

    await expect(page.getByRole('heading', { name: /the room is quiet again/i })).toBeVisible();
    await expect(page.getByText('Speak slowly and look up between points.')).toBeVisible();
    await expect(page.getByText('Camera off', { exact: true })).toBeVisible();

    await page.locator('.report-scale__item').nth(3).click();
    await expect(page.getByRole('radio', { name: /mostly ready/i })).toBeChecked();

    await page.getByRole('button', { name: /finish and clear the session/i }).click();
    await expect(page.getByRole('heading', { name: 'LumaPause' })).toBeVisible();
    await expect(page.getByText('Session cleared from memory')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Begin privately' })).toBeVisible();

    // Clearing must remove the intention and the self-report from the DOM.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Speak slowly and look up between points.');
    expect(body).not.toContain('Mostly ready');
  } finally {
    await closeApp(app);
  }
});
