import { BrowserWindow, Menu, app, dialog } from 'electron';
import { IPC } from '../shared/constants';
import type { MainEvent } from '../shared/contracts';
import { configureNativeRuntimeEnvironment, credentials, loadCredentials } from './credentials';
import { registerIpc, type IpcHandle } from './ipc';
import { configureSessionSecurity } from './security';
import { SessionService } from './smartspectra/service';
import { createMainWindow } from './window';

app.setName('LumaPause');
app.setAppUserModelId('studio.lumapause.app');

function resolveDevServerUrl(): string | null {
  if (app.isPackaged) return null;
  const raw = process.env.LUMAPAUSE_DEV_SERVER_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'http:' || !local) return null;
    return raw;
  } catch {
    return null;
  }
}

function installMenu(): void {
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'LumaPause',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let window: BrowserWindow | null = null;
  let ipc: IpcHandle | null = null;
  let shuttingDown = false;
  let shutdownComplete = false;

  const devServerUrl = resolveDevServerUrl();

  const send = (event: MainEvent): void => {
    if (!window || window.isDestroyed()) return;
    window.webContents.send(IPC.event, event);
  };

  const service = new SessionService({
    emit: send,
    credentials,
    verboseValidationLogs: !app.isPackaged,
  });

  const openWindow = (): void => {
    window = createMainWindow({ devServerUrl });
    ipc = registerIpc({ window, service, credentials });
    window.on('close', () => {
      // A window close is an immediate stop. The camera and sensor pipeline do
      // not survive into the background.
      void service.stopSession().catch(() => undefined);
    });
    window.on('closed', () => {
      window = null;
      ipc = null;
    });
  };

  app.on('second-instance', () => {
    if (!window) {
      if (app.isReady()) openWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && shutdownComplete === false) {
      openWindow();
    }
  });

  app.on('before-quit', (event) => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    // Wipes adapter buffers, stops the SDK, clears the session, then quits.
    void service
      .shutdown()
      .catch((error) => console.error('[LumaPause] shutdown failed:', error))
      .finally(() => {
        ipc?.dispose();
        ipc = null;
        shutdownComplete = true;
        app.quit();
      });
  });

  await app.whenReady();

  configureNativeRuntimeEnvironment();
  loadCredentials();
  configureSessionSecurity(devServerUrl);
  installMenu();

  try {
    openWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('LumaPause could not start', message);
    app.quit();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox('LumaPause could not start', message);
  app.quit();
});
