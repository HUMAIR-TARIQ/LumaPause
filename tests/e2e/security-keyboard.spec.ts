import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers';

test('keeps the renderer sandboxed and blocks unapproved navigation', async () => {
  const sentinel = 'E2E_SECURITY_SENTINEL_KEY_987654321';
  const { app, page } = await launchApp({ key: sentinel });
  try {
    const surface = await page.evaluate(() => {
      const bridge = window.lumapause;
      return {
        hasRequire: typeof (window as unknown as { require?: unknown }).require,
        hasProcess: typeof (window as unknown as { process?: unknown }).process,
        hasElectron: typeof (window as unknown as { electron?: unknown }).electron,
        bridgeKeys: Object.keys(bridge).sort(),
        frozen: Object.isFrozen(bridge),
        origin: window.location.protocol,
      };
    });

    expect(surface.hasRequire).toBe('undefined');
    expect(surface.hasProcess).toBe('undefined');
    expect(surface.hasElectron).toBe('undefined');
    expect(surface.frozen).toBe(true);
    expect(surface.origin).toBe('file:');
    expect(surface.bridgeKeys).toEqual(
      [
        'attachFramePort',
        'finishSession',
        'getEnvironment',
        'getStatus',
        'markRoomStart',
        'onEvent',
        'prepareSession',
        'retrySession',
        'sendFrame',
        'setExpressionResponsiveness',
        'setScenario',
        'startDemo',
        'startSession',
        'stopSession',
      ].sort(),
    );

    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(policy).toBeTruthy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).not.toContain('unsafe-eval');

    const opened = await page.evaluate(() => window.open('https://example.com/', '_blank'));
    expect(opened).toBeNull();

    const urlBefore = page.url();
    await page
      .evaluate(() => {
        window.location.assign('https://example.com/');
      })
      .catch(() => undefined);
    await page.waitForTimeout(600);
    expect(page.url()).toBe(urlBefore);

    const html = await page.content();
    expect(html).not.toContain(sentinel);
    expect(JSON.stringify(await page.evaluate(() => window.lumapause))).not.toContain(sentinel);
  } finally {
    await closeApp(app);
  }
});

test('supports keyboard operation and honours reduced motion', async () => {
  const { app, page } = await launchApp({ key: null });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.app--reduce')).toBeVisible({ timeout: 10_000 });

    const begin = page.getByRole('button', { name: 'Begin privately' });
    await begin.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: /live measurement needs a little setup/i }),
    ).toBeVisible();

    // The heading receives programmatic focus on each screen change.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? '')).toBe('H1');

    const demo = page.getByRole('button', { name: 'Explore demo mode' });
    await demo.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /choose a simulated scenario/i })).toBeVisible();

    const start = page.getByRole('button', { name: 'Enter demo room' });
    await start.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /learn your rhythm/i })).toBeVisible();
    await expect(page.locator('.app--reduce')).toBeVisible();

    const continueButton = page.locator('button:has-text("Continue to the room"):not([disabled])');
    await continueButton.waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Continue to the room' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /two quiet minutes/i })).toBeVisible();

    await page.getByRole('button', { name: 'Enter the room' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Arrive', exact: true })).toBeVisible();

    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? '')).toBe('H1');

    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('aside[aria-label="Developer overlay"]')).toBeVisible();
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('aside[aria-label="Developer overlay"]')).toBeHidden();

    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ''))
      .toBe('BUTTON');
  } finally {
    await closeApp(app);
  }
});
