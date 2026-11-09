import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers';

test('offers an explicit partial path and never promotes the missing pulse', async () => {
  const { app, page } = await launchApp({ key: null, timingScale: 0.1 });
  try {
    await page.getByRole('button', { name: 'Begin privately' }).click();
    await page.getByRole('button', { name: 'Explore demo mode' }).click();
    await page.getByText('Breathing only', { exact: true }).click();
    await expect(page.getByRole('radio', { name: /breathing only/i })).toBeChecked();
    await page.getByRole('button', { name: 'Enter demo room' }).click();

    await expect(page.getByRole('heading', { name: /learn your rhythm/i })).toBeVisible();
    const partialAction = page.locator(
      'button:has-text("Continue with what is available"):not([disabled])',
    );
    await partialAction.waitFor({ timeout: 30_000 });
    await partialAction.click();

    await expect(
      page.getByRole('heading', { name: /the room can follow breathing alone/i }),
    ).toBeVisible();
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await expect(page.getByText('Ambient only', { exact: true })).toBeVisible();
    await expect(page.getByText(/missing data is never shown as a reading/i)).toBeVisible();

    await page.getByRole('button', { name: /enter the room with these signals/i }).click();
    await expect(page.getByRole('heading', { name: 'Arrive', exact: true })).toBeVisible();
    await expect(page.getByText('Simulated · camera off')).toBeVisible();

    // Breathing settles while pulse never reaches the official threshold.
    await expect(page.getByText('Partial simulated signal')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Simulated breathing and pulse')).toHaveCount(0);

    await page.getByRole('button', { name: /stop and see reflection/i }).click();
    await expect(page.getByRole('heading', { name: /the room is quiet again/i })).toBeVisible();
    await expect(page.getByText('breathing, expression patterns')).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
