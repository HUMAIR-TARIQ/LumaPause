/**
 * Sandboxed preload bridge.
 *
 * The renderer receives a small, typed surface and never sees `ipcRenderer`,
 * Node primitives, or the API key. Camera frames travel over a private
 * MessagePort owned by this script; low-frequency session commands use
 * request/response IPC.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/constants';
import type {
  ApiResult,
  EnvironmentInfo,
  FramePacketHeader,
  LumaPauseApi,
  MainEvent,
  PrepareSessionRequest,
  PrepareSessionResult,
  RuntimeStatus,
  SessionFacts,
  SimulatorScenario,
} from '../shared/contracts';

let framePort: MessagePort | null = null;

/**
 * Open the private frame channel. The port is created here, not in the page, so
 * the renderer cannot address arbitrary main-process channels. The transfer
 * list hands port2 to the main process; frames are structured-cloned into it,
 * which is the reliable path for ArrayBuffers through Electron's port bridge.
 */
function attachFramePort(): void {
  if (framePort) return;
  const channel = new MessageChannel();
  framePort = channel.port1;
  channel.port1.start();
  ipcRenderer.postMessage(IPC.framePort, { version: 1 }, [channel.port2]);
}

function sendFrame(header: FramePacketHeader, buffer: ArrayBuffer): void {
  if (!framePort) attachFramePort();
  if (!framePort) return;
  try {
    framePort.postMessage({
      width: header.width,
      height: header.height,
      stride: header.stride,
      format: header.format,
      timestampUs: header.timestampUs,
      buffer,
    });
  } catch {
    // A frame is disposable. The main process counts drops; never throw into
    // the measurement loop because one frame could not be cloned.
  }
}

function invoke<T>(channel: string, payload?: unknown): Promise<ApiResult<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<ApiResult<T>>;
}

const api: LumaPauseApi = {
  getEnvironment: () => ipcRenderer.invoke(IPC.environment) as Promise<EnvironmentInfo>,
  getStatus: () => ipcRenderer.invoke(IPC.status) as Promise<RuntimeStatus>,
  prepareSession: (request: PrepareSessionRequest) =>
    invoke<PrepareSessionResult>(IPC.prepare, request),
  startSession: () => invoke<null>(IPC.start),
  stopSession: () => invoke<SessionFacts>(IPC.stop),
  finishSession: () => invoke<null>(IPC.finish),
  retrySession: () => invoke<PrepareSessionResult>(IPC.retry),
  startDemo: (scenario: SimulatorScenario, expressionResponsiveness: boolean) =>
    invoke<PrepareSessionResult>(IPC.demo, { scenario, expressionResponsiveness }),
  setScenario: (scenario: SimulatorScenario) => invoke<null>(IPC.scenario, { scenario }),
  setExpressionResponsiveness: (enabled: boolean) => invoke<null>(IPC.expression, { enabled }),
  markRoomStart: () => invoke<null>(IPC.roomStart),
  attachFramePort,
  sendFrame,
  onEvent(listener: (event: MainEvent) => void): () => void {
    const wrapped = (_event: IpcRendererEvent, payload: MainEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(IPC.event, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC.event, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('lumapause', api);
