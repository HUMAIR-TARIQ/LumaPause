import {
  ipcMain,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessagePortMain,
} from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/constants';
import type { ApiResult } from '../shared/contracts';
import {
  demoRequestSchema,
  expressionRequestSchema,
  prepareSessionRequestSchema,
  scenarioRequestSchema,
  validateFramePacket,
} from '../shared/ipc-schemas';
import { SessionFailure, invalidStateError, mapUnknownError } from './smartspectra/errors';
import type { CredentialProvider, SessionService } from './smartspectra/service';

export interface IpcOptions {
  window: BrowserWindow;
  service: SessionService;
  credentials: CredentialProvider;
}

export interface IpcHandle {
  dispose(): void;
}

const CHANNELS = [
  IPC.environment,
  IPC.status,
  IPC.prepare,
  IPC.start,
  IPC.stop,
  IPC.finish,
  IPC.retry,
  IPC.demo,
  IPC.scenario,
  IPC.expression,
  IPC.roomStart,
] as const;

function isTrusted(event: IpcMainInvokeEvent | IpcMainEvent, window: BrowserWindow): boolean {
  if (event.sender !== window.webContents) return false;
  const senderFrame = event.senderFrame;
  if (!senderFrame) return false;
  // Only the top-level app document may invoke session commands. Workers and
  // any future iframe cannot address the main process.
  return senderFrame === window.webContents.mainFrame;
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new SessionFailure(invalidStateError(`The ${label} request was malformed.`));
  }
  return result.data;
}

/**
 * Wire the typed session IPC surface. Every payload is validated, every sender
 * is checked against the single app window, and failures become typed
 * ApiResults instead of raw stack traces in the renderer.
 */
export function registerIpc(options: IpcOptions): IpcHandle {
  const { window, service, credentials } = options;
  let framePort: MessagePortMain | null = null;
  let reportedFrameRejection = false;

  const run = async <T>(work: () => Promise<T> | T): Promise<ApiResult<T>> => {
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      const info = mapUnknownError(error, credentials.getApiKey());
      // The error message is redacted by mapUnknownError; never log the key.
      console.error(`[LumaPause] ${info.code}: ${info.message}`);
      return { ok: false, error: info };
    }
  };

  const handle = (channel: string, work: (payload: unknown) => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, (event, payload) => {
      if (!isTrusted(event, window)) {
        throw new Error('Blocked an IPC request from an untrusted frame.');
      }
      return run(() => work(payload));
    });
  };

  ipcMain.handle(IPC.environment, (event) => {
    if (!isTrusted(event, window)) {
      throw new Error('Blocked an IPC request from an untrusted frame.');
    }
    return service.getEnvironment();
  });

  ipcMain.handle(IPC.status, (event) => {
    if (!isTrusted(event, window)) {
      throw new Error('Blocked an IPC request from an untrusted frame.');
    }
    return service.getStatus();
  });

  handle(IPC.prepare, (payload) =>
    service.prepareSession(parse(prepareSessionRequestSchema, payload, 'session')),
  );
  handle(IPC.start, () => service.startSession());
  handle(IPC.stop, () => service.stopSession());
  handle(IPC.finish, () => service.finishSession());
  handle(IPC.retry, () => service.retrySession());
  handle(IPC.demo, (payload) => {
    const request = parse(demoRequestSchema, payload, 'demo');
    return service.startDemo(request.scenario, request.expressionResponsiveness);
  });
  handle(IPC.scenario, (payload) => {
    const request = parse(scenarioRequestSchema, payload, 'scenario');
    return service.setScenario(request.scenario);
  });
  handle(IPC.expression, (payload) => {
    const request = parse(expressionRequestSchema, payload, 'expression');
    return service.setExpressionResponsiveness(request.enabled);
  });
  handle(IPC.roomStart, () => service.markRoomStart());

  ipcMain.on(IPC.framePort, (event) => {
    if (!isTrusted(event, window)) return;
    const next = event.ports[0];
    if (!next) return;

    if (framePort) {
      try {
        framePort.close();
      } catch {
        /* the previous renderer may already be gone */
      }
    }
    framePort = next;

    next.on('message', (message) => {
      if (framePort !== next) return;
      try {
        const validation = validateFramePacket(message.data);
        if (!validation.ok) {
          service.recordRejectedFrame();
          if (!reportedFrameRejection && process.env.NODE_ENV !== 'production') {
            reportedFrameRejection = true;
            console.warn(`[LumaPause] first frame packet rejected: ${validation.reason}`);
          }
          return;
        }
        service.handleFrame(validation.packet);
      } catch (error) {
        service.recordRejectedFrame();
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[LumaPause] frame packet rejected:', mapUnknownError(error).message);
        }
      }
    });
    next.start();
  });

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners(IPC.framePort);
    if (framePort) {
      try {
        framePort.close();
      } catch {
        /* already closed */
      }
      framePort = null;
    }
  };

  window.once('closed', dispose);

  return { dispose };
}
