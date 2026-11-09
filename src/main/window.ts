import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME } from '../shared/constants';
import { configureNavigationGuards } from './security';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface MainWindowOptions {
  devServerUrl: string | null;
}

/**
 * Create the single application window with the hardened renderer settings
 * required by the project: context isolation on, Node integration off, sandbox
 * on, no webviews, no pop-ups, and no navigation away from the app.
 */
export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0B1512',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      // The measurement loop must keep receiving camera frames even while the
      // window is partly obscured. Capture itself is still gated on consent and
      // runs only during an explicit session.
      backgroundThrottling: false,
    },
  });

  configureNavigationGuards(window, options.devServerUrl);

  window.once('ready-to-show', () => {
    window.show();
  });

  // Never let the renderer open an external application. There are no outbound
  // links in the UI; if one is ever added it must use an explicit, reviewed
  // main-process action instead of a navigation.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-redirect', (event) => {
    event.preventDefault();
  });

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl);
    if (!app.isPackaged && process.env.LUMAPAUSE_OPEN_DEVTOOLS === '1') {
      window.webContents.once('did-finish-load', () => {
        window.webContents.openDevTools({ mode: 'detach' });
      });
    }
  } else {
    void window.loadFile(path.join(here, '../renderer/index.html'));
  }

  return window;
}
