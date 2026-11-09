import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { CONSENT_VERSION, IPC } from '../../src/shared/constants';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>();
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    handlers,
    listeners,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      }),
      on: vi.fn((channel: string, listener: (event: unknown) => void) => {
        listeners.set(channel, listener);
      }),
      removeAllListeners: vi.fn((channel: string) => {
        listeners.delete(channel);
      }),
    },
  };
});

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }));

import { registerIpc } from '../../src/main/ipc';
import type { CredentialProvider, SessionService } from '../../src/main/smartspectra/service';

const mainFrame = { name: 'main' };
const webContents = { mainFrame, id: 1 };
const window = {
  webContents,
  once: vi.fn(),
} as unknown as BrowserWindow;
const trusted = {
  sender: webContents,
  senderFrame: mainFrame,
} as unknown as IpcMainInvokeEvent;
const untrusted = {
  sender: { mainFrame: { name: 'other' } },
  senderFrame: mainFrame,
} as unknown as IpcMainInvokeEvent;

const environment = {
  appVersion: '1.0.0',
  sdkVersion: '3.4.0',
  platform: 'win32',
  arch: 'x64',
  platformSupported: true,
  keyPresent: true,
  keySource: 'environment' as const,
  simulatorAvailable: true as const,
  telemetryDisabled: true as const,
  telemetryNote: 'disabled',
  nativeRuntimeError: null,
  consentVersion: CONSENT_VERSION,
  timingScale: 1,
};

const preparePayload = {
  consent: {
    granted: true,
    version: CONSENT_VERSION,
    at: 1_760_000_000_000,
    camera: true,
    expression: false,
    simulator: false,
  },
  mode: 'live',
  expressionResponsiveness: false,
};

function fakeService() {
  return {
    getEnvironment: vi.fn(() => environment),
    getStatus: vi.fn(() => ({
      mode: null,
      phase: 'idle' as const,
      keyPresent: true,
      platformSupported: true,
      snapshot: null,
    })),
    prepareSession: vi.fn(async () => ({ mode: 'live' as const })),
    startSession: vi.fn(async () => null),
    stopSession: vi.fn(async () => ({ mode: 'live' as const })),
    finishSession: vi.fn(async () => null),
    retrySession: vi.fn(async () => ({ mode: 'live' as const })),
    startDemo: vi.fn(async () => ({ mode: 'simulated' as const })),
    setScenario: vi.fn(async () => null),
    setExpressionResponsiveness: vi.fn(async () => null),
    markRoomStart: vi.fn(async () => null),
    recordRejectedFrame: vi.fn(),
    handleFrame: vi.fn(() => true),
  };
}

const credentials: CredentialProvider = {
  getApiKey: () => 'sk-test-secret-123456',
  getEnvironment: () => environment,
};

function call(channel: string, event: unknown, payload?: unknown): unknown {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`missing handler for ${channel}`);
  return handler(event, payload);
}

beforeEach(() => {
  electron.handlers.clear();
  electron.listeners.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('typed IPC bridge', () => {
  it('registers every channel and disposes handlers and the window hook', () => {
    const service = fakeService();
    const handle = registerIpc({
      window,
      service: service as unknown as SessionService,
      credentials,
    });

    for (const channel of Object.values(IPC)) {
      if (channel === IPC.event) continue;
      expect(electron.handlers.has(channel) || electron.listeners.has(channel)).toBe(true);
    }

    handle.dispose();
    expect(electron.handlers.size).toBe(0);
    expect(electron.listeners.size).toBe(0);
    handle.dispose();
    expect(electron.handlers.size).toBe(0);
  });

  it('returns environment and status directly and blocks other frames', () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    expect(call(IPC.environment, trusted)).toEqual(environment);
    expect(call(IPC.status, trusted)).toMatchObject({ phase: 'idle' });
    expect(() => call(IPC.environment, untrusted)).toThrow(/untrusted frame/i);
    expect(() => call(IPC.environment, { sender: webContents, senderFrame: null })).toThrow(
      /untrusted frame/i,
    );
  });

  it('validates the prepare payload before calling the service', async () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    const rejected = await call(IPC.prepare, trusted, { ...preparePayload, mode: 'wat' });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'INVALID_STATE' },
    });
    expect(service.prepareSession).not.toHaveBeenCalled();

    const accepted = await call(IPC.prepare, trusted, preparePayload);
    expect(accepted).toMatchObject({ ok: true });
    expect(service.prepareSession).toHaveBeenCalledWith(preparePayload);
  });

  it('validates demo, scenario and expression payloads', async () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    expect(
      await call(IPC.demo, trusted, { scenario: 'motion', expressionResponsiveness: true }),
    ).toMatchObject({ ok: true });
    expect(service.startDemo).toHaveBeenCalledWith('motion', true);

    expect(
      await call(IPC.demo, trusted, { scenario: 'motion', expressionResponsiveness: 'yes' }),
    ).toMatchObject({ ok: false });
    expect(await call(IPC.scenario, trusted, { scenario: 'poor_lighting' })).toMatchObject({
      ok: true,
    });
    expect(service.setScenario).toHaveBeenCalledWith('poor_lighting');
    expect(await call(IPC.expression, trusted, { enabled: true })).toMatchObject({ ok: true });
    expect(service.setExpressionResponsiveness).toHaveBeenCalledWith(true);
    expect(await call(IPC.expression, trusted, {})).toMatchObject({ ok: false });
  });

  it('converts thrown service errors into typed ApiResults', async () => {
    const service = fakeService();
    service.startSession.mockRejectedValueOnce(new Error('camera exploded'));
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    const result = await call(IPC.start, trusted);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', kind: 'recoverable' },
    });
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-123456');
  });

  it('forwards only validated frame packets from a trusted port', () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    const port = {
      on: vi.fn(),
      close: vi.fn(),
      start: vi.fn(),
    };
    const listener = electron.listeners.get(IPC.framePort);
    expect(listener).toBeDefined();
    listener?.({ ...trusted, ports: [port] } as unknown as IpcMainEvent);
    expect(port.start).toHaveBeenCalled();

    interface PortMessage {
      data: unknown;
    }
    const onMessage = port.on.mock.calls.find(([name]) => name === 'message')?.[1] as (
      message: PortMessage,
    ) => void;
    expect(onMessage).toBeDefined();

    const width = 16;
    const height = 16;
    const stride = width * 4;
    onMessage?.({
      data: {
        width,
        height,
        stride,
        format: 'rgba',
        timestampUs: 1,
        buffer: new ArrayBuffer(stride * height),
      },
    });
    expect(service.handleFrame).toHaveBeenCalledWith(
      expect.objectContaining({ width, height, stride, format: 'rgba' }),
    );

    onMessage?.({ data: { width: 2, height: 2, stride: 8, format: 'rgba' } });
    expect(service.recordRejectedFrame).toHaveBeenCalledTimes(1);
    expect(service.handleFrame).toHaveBeenCalledTimes(1);
  });

  it('ignores a frame port from an untrusted frame', () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });

    const port = { on: vi.fn(), close: vi.fn(), start: vi.fn() };
    const listener = electron.listeners.get(IPC.framePort);
    listener?.({ ...untrusted, ports: [port] } as unknown as IpcMainEvent);
    expect(port.start).not.toHaveBeenCalled();
  });

  it('closes the previous frame port when the renderer reattaches', () => {
    const service = fakeService();
    registerIpc({ window, service: service as unknown as SessionService, credentials });
    const listener = electron.listeners.get(IPC.framePort);

    const first = { on: vi.fn(), close: vi.fn(), start: vi.fn() };
    const second = { on: vi.fn(), close: vi.fn(), start: vi.fn() };
    listener?.({ ...trusted, ports: [first] } as unknown as IpcMainEvent);
    listener?.({ ...trusted, ports: [second] } as unknown as IpcMainEvent);

    expect(first.close).toHaveBeenCalled();
    expect(second.start).toHaveBeenCalled();
  });
});
