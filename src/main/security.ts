import { app, session, type BrowserWindow } from 'electron';
import { contentSecurityPolicy } from '../shared/csp';

function trustedUrl(url: string, devServerUrl: string | null): boolean {
  if (devServerUrl) return url.startsWith(devServerUrl);
  return url.startsWith('file://');
}

/**
 * Permission surface. Camera access is granted only to LumaPause's own page,
 * only for video, and only after the renderer asks (which happens after
 * informed consent). Audio, notifications, geolocation, HID and every other
 * permission are denied.
 */
export function configureSessionSecurity(devServerUrl: string | null): void {
  const denyCamera = process.env.LUMAPAUSE_E2E_DENY_CAMERA === '1';
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl =
      (details as { requestingUrl?: string }).requestingUrl ?? webContents?.getURL() ?? '';
    if (permission !== 'media') return callback(false);
    if (denyCamera) return callback(false);
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    if (mediaTypes.some((type) => type === 'audio')) return callback(false);
    callback(trustedUrl(requestingUrl, devServerUrl));
  });

  defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission !== 'media') return false;
    if (denyCamera) return false;
    const mediaType = (details as { mediaType?: string }).mediaType;
    if (mediaType === 'audio') return false;
    const url = requestingOrigin || webContents?.getURL() || '';
    return trustedUrl(url, devServerUrl);
  });

  defaultSession.setDevicePermissionHandler(() => false);
  defaultSession.setSpellCheckerEnabled(false);

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!trustedUrl(details.url, devServerUrl)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [contentSecurityPolicy(!app.isPackaged)];
    headers['X-Content-Type-Options'] = ['nosniff'];
    headers['Referrer-Policy'] = ['no-referrer'];
    headers['Permissions-Policy'] = ['camera=(self), microphone=(), geolocation=()'];
    callback({ responseHeaders: headers });
  });
}

let globalGuardInstalled = false;

/** Block navigation and new windows for every renderer in the app. */
export function configureNavigationGuards(
  window: BrowserWindow,
  devServerUrl: string | null,
): void {
  const { webContents } = window;

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-navigate', (event, url) => {
    const current = webContents.getURL();
    if (url !== current && !trustedUrl(url, devServerUrl)) {
      event.preventDefault();
    }
  });

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (globalGuardInstalled) return;
  globalGuardInstalled = true;

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const current = contents.getURL();
      if (url !== current && !trustedUrl(url, devServerUrl)) {
        event.preventDefault();
      }
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
