import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

export interface LaunchOptions {
  /** Sentinel or dummy key. Pass null to guarantee no live key is present. */
  key?: string | null;
  denyCamera?: boolean;
  timingScale?: number;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
}

/**
 * Launch the built Electron app for end-to-end tests.
 *
 * `ELECTRON_RUN_AS_NODE` is set by some CI/agent environments and makes the
 * Electron binary behave like Node, which crashes the packaged entrypoint. It
 * must be removed before spawning Electron.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  env.LUMAPAUSE_TIMING_SCALE = String(options.timingScale ?? 0.1);

  if (options.key === null || options.key === undefined) {
    // An empty value is still "present", so dotenv will not fill it from a
    // developer's local `.env`. This keeps tests isolated from a real key.
    env.SMARTSPECTRA_API_KEY = '';
  } else {
    env.SMARTSPECTRA_API_KEY = options.key;
  }

  if (options.denyCamera) env.LUMAPAUSE_E2E_DENY_CAMERA = '1';
  else delete env.LUMAPAUSE_E2E_DENY_CAMERA;

  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env,
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await page.waitForSelector('h1', { timeout: 20_000 });
  await page.waitForTimeout(400);
  return { app, page };
}

export async function closeApp(app: ElectronApplication): Promise<void> {
  try {
    await app.close();
  } catch {
    /* the window may already be gone after a failed assertion */
  }
}

/** Wait for the calibration primary action to become usable without eval (CSP-safe). */
export async function waitForCalibrationReady(page: Page): Promise<void> {
  await page
    .locator('button:has-text("Continue to the room"):not([disabled])')
    .waitFor({ timeout: 30_000 });
}
