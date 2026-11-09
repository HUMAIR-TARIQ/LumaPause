import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers';

test('explains missing setup and never requests a camera before consent', async () => {
  const { app, page } = await launchApp({ key: null });
  try {
    await expect(page.getByText('Setup guidance available')).toBeVisible();
    const cameraBefore = await page.evaluate(() => {
      const video = document.querySelector('video');
      return video ? video.srcObject !== null : false;
    });
    expect(cameraBefore).toBe(false);

    await page.getByRole('button', { name: 'Begin privately' }).click();
    await expect(
      page.getByRole('heading', { name: /live measurement needs a little setup/i }),
    ).toBeVisible();
    await expect(page.getByText('No API key detected')).toBeVisible();
    await expect(page.getByText(/never sent to this window/i)).toBeVisible();
    await expect(page.getByText('.env*').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Explore demo mode' })).toBeEnabled();

    const body = await page.locator('body').innerText();
    // The screen documents the placeholder, but no key-shaped value is present.
    expect(body).toContain('SMARTSPECTRA_API_KEY=YOUR_KEY');
    expect(body).not.toMatch(/sk-[A-Za-z0-9_-]{10,}/);
  } finally {
    await closeApp(app);
  }
});

test('requires the consent checkbox before enabling the camera', async () => {
  const sentinel = 'E2E_SENTINEL_KEY_NOT_A_REAL_SECRET_123456789';
  const { app, page } = await launchApp({ key: sentinel, denyCamera: true });
  try {
    await page.getByRole('button', { name: 'Begin privately' }).click();
    await expect(
      page.getByRole('heading', { name: /you decide what the camera sees/i }),
    ).toBeVisible();

    const enable = page.getByRole('button', { name: 'Enable camera' });
    await expect(enable).toBeDisabled();
    await expect(page.locator('.sim-banner')).toHaveCount(0);

    await page.getByRole('checkbox').first().check();
    await expect(enable).toBeEnabled();

    // The key exists only in the main process; it must never be serialized into
    // the document, storage, or the preload-exposed environment object.
    const html = await page.content();
    expect(html).not.toContain(sentinel);
    const storage = await page.evaluate(() => {
      try {
        return JSON.stringify({
          local: localStorage,
          session: sessionStorage,
          env: window.lumapause ?? null,
        });
      } catch {
        return 'storage unavailable';
      }
    });
    expect(JSON.stringify(storage)).not.toContain(sentinel);

    await enable.click();
    await expect(
      page.getByRole('heading', { name: /camera permission was not granted/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Nothing is being captured')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try the camera again' })).toBeVisible();
    await expect(page.getByText(/holding the permission/i)).toBeVisible();

    await page.getByRole('button', { name: 'Continue in demo mode' }).click();
    await expect(page.getByRole('heading', { name: /choose a simulated scenario/i })).toBeVisible();
    await expect(page.getByText('Not SmartSpectra data', { exact: true })).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
