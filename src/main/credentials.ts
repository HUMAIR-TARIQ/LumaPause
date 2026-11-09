import { app } from 'electron';
import { config as loadDotenv } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { EnvironmentInfo } from '../shared/contracts';
import { CONSENT_VERSION } from '../shared/constants';
import type { CredentialProvider } from './smartspectra/service';

const KEY_NAME = 'SMARTSPECTRA_API_KEY';
const SUPPORTED = new Set(['win32-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']);

const LIB_BASENAME: Record<string, string> = {
  win32: 'smartspectra_capi.dll',
  darwin: 'libsmartspectra_capi.dylib',
  linux: 'libsmartspectra_capi.so',
};

let apiKey: string | null = null;
let keySource: EnvironmentInfo['keySource'] = 'missing';
let credentialsLoaded = false;
let cachedSdkVersion: string | null | undefined;

function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function safeSdkVersion(): string | null {
  if (cachedSdkVersion !== undefined) return cachedSdkVersion;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('@smartspectra/node-sdk/package.json') as { version?: string };
    cachedSdkVersion = typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    cachedSdkVersion = null;
  }
  return cachedSdkVersion;
}

/**
 * Packaged builds copy the per-platform native closure to
 * `resources/smartspectra/`. The SDK's own resolver honours this documented
 * developer override, which keeps native loading out of the asar archive.
 */
export function configureNativeRuntimeEnvironment(): void {
  if (!app.isPackaged) return;
  const libName = LIB_BASENAME[process.platform];
  if (!libName) return;
  const candidate = path.join(process.resourcesPath, 'smartspectra', libName);
  if (fs.existsSync(candidate)) {
    process.env.SMARTSPECTRA_CAPI_PATH = candidate;
  }
}

/**
 * Load SMARTSpectra credentials from the process environment, or from a local
 * `.env` file in development. The key never leaves the main process.
 */
export function loadCredentials(): void {
  if (credentialsLoaded) return;
  credentialsLoaded = true;

  const fromEnvironment = process.env[KEY_NAME]?.trim();
  if (fromEnvironment) {
    apiKey = fromEnvironment;
    keySource = 'environment';
    return;
  }

  if (!app.isPackaged) {
    const envPath = path.join(app.getAppPath(), '.env');
    if (fs.existsSync(envPath)) {
      loadDotenv({ path: envPath });
      const fromDotenv = process.env[KEY_NAME]?.trim();
      if (fromDotenv) {
        apiKey = fromDotenv;
        keySource = 'dotenv';
        return;
      }
    }
  }

  apiKey = null;
  keySource = 'missing';
}

function nativeRuntimeError(): string | null {
  if (!SUPPORTED.has(platformKey())) {
    return `SmartSpectra publishes no native runtime for ${platformKey()}. Supported: win32-x64, darwin-arm64, linux-x64, linux-arm64.`;
  }
  const libName = LIB_BASENAME[process.platform];
  if (!libName) return `Unknown native library for ${process.platform}.`;

  const override = process.env.SMARTSPECTRA_CAPI_PATH;
  if (override) {
    return fs.existsSync(override)
      ? null
      : `SMARTSPECTRA_CAPI_PATH points to a missing file: ${override}`;
  }

  try {
    const require = createRequire(import.meta.url);
    const pkgRoot = path.dirname(
      require.resolve(`@smartspectra/node-sdk-${platformKey()}/package.json`),
    );
    const libPath = path.join(pkgRoot, libName);
    if (!fs.existsSync(libPath)) {
      return `The native runtime package is installed but ${libName} is missing. Reinstall dependencies.`;
    }
    return null;
  } catch {
    return `The native runtime package @smartspectra/node-sdk-${platformKey()} is not installed. Reinstall dependencies.`;
  }
}

function timingScale(): number {
  // Test-only acceleration. Ignored in packaged builds so the public experience
  // always uses the documented calibration and two-minute room timings.
  if (app.isPackaged) return 1;
  const raw = Number(process.env.LUMAPAUSE_TIMING_SCALE);
  if (!Number.isFinite(raw)) return 1;
  return Math.min(1, Math.max(0.02, raw));
}

export const credentials: CredentialProvider = {
  getApiKey(): string | null {
    loadCredentials();
    return apiKey;
  },
  getEnvironment(): EnvironmentInfo {
    loadCredentials();
    return {
      appVersion: app.getVersion(),
      sdkVersion: safeSdkVersion(),
      platform: process.platform,
      arch: process.arch,
      platformSupported: SUPPORTED.has(platformKey()),
      keyPresent: Boolean(apiKey),
      keySource,
      simulatorAvailable: true,
      telemetryDisabled: true,
      telemetryNote:
        'LumaPause constructs the SDK with enableTelemetry: false. Presage is contacted only to validate the API key and subscription; metrics are computed locally.',
      nativeRuntimeError: nativeRuntimeError(),
      consentVersion: CONSENT_VERSION,
      timingScale: timingScale(),
    };
  },
};

export const CREDENTIAL_ENV_NAME = KEY_NAME;
