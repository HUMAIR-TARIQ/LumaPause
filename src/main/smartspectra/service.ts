import { CONSENT_VERSION, SNAPSHOT_INTERVAL_MS } from '../../shared/constants';
import { createRequire } from 'node:module';
import type {
  EnvironmentInfo,
  MainEvent,
  Mode,
  PrepareSessionRequest,
  PrepareSessionResult,
  ProcessingState,
  RuntimeStatus,
  SessionFacts,
  SignalSnapshot,
  SimulatorScenario,
} from '../../shared/contracts';
import { mapValidation } from '../../shared/validation-guidance';
import { SignalSimulator } from '../../simulator/signal-simulator';
import { MetricsAdapter, processingFromCode, type MetricsLike } from './metrics-adapter';
import {
  SessionFailure,
  consentRequiredError,
  invalidStateError,
  mapSdkError,
  mapUnknownError,
} from './errors';

export interface SmartSpectraOptionsLike {
  apiKey?: string;
  requestedMetrics?: number[];
  enableTelemetry?: boolean;
  enableAccumulatedOutput?: boolean;
  logLevel?: number;
}

export interface SmartSpectraSdkLike {
  on(event: string, callback: (...args: unknown[]) => void): this;
  useCustomInput(transform?: number): this;
  start(): void;
  stopAsync(): Promise<void>;
  reset(): void;
  destroy(): Promise<void>;
  sendFrame(
    buffer: Uint8Array,
    width: number,
    height: number,
    stride: number,
    pixelFormat: number,
    timestampUs: number,
  ): boolean;
}

export interface SmartSpectraModuleLike {
  SmartSpectraSDK: (new (options: SmartSpectraOptionsLike) => SmartSpectraSdkLike) & {
    version?: string;
  };
  ProcessingStatus: Record<string, number>;
  PixelFormat: Record<string, number>;
  MetricType: Record<string, number>;
  SmartSpectraLogLevel: Record<string, number>;
  FrameTransform: Record<string, number>;
}

export interface FramePacket {
  width: number;
  height: number;
  stride: number;
  format: 'rgba';
  timestampUs: number;
  buffer: ArrayBuffer;
}

export interface CredentialProvider {
  getApiKey(): string | null;
  getEnvironment(): EnvironmentInfo;
}

export interface ServiceDependencies {
  emit: (event: MainEvent) => void;
  credentials: CredentialProvider;
  loadSdk?: () => Promise<SmartSpectraModuleLike>;
  decodeMetrics?: (buffer: Buffer | Uint8Array) => unknown;
  now?: () => number;
  /** Enables verbatim SDK validation logging. Main passes true in development. */
  verboseValidationLogs?: boolean;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const DEFAULT_METRICS = { CHEST_BREATHING: 0, BREATHING_RATE: 2, EXPRESSIONS: 14, PULSE_RATE: 15 };
const require = createRequire(import.meta.url);
const { decodeMetrics: decodeSdkMetrics } = require('@smartspectra/node-sdk/messages') as {
  decodeMetrics: (buffer: Buffer | Uint8Array) => unknown;
};

async function loadDefaultSdk(): Promise<SmartSpectraModuleLike> {
  return require('@smartspectra/node-sdk') as SmartSpectraModuleLike;
}

function zeroFacts(mode: Mode): SessionFacts {
  return {
    mode,
    durationMs: 0,
    roomDurationMs: 0,
    calibrationDurationMs: 0,
    signalsAvailable: { pulse: false, breathing: false, expression: false },
    stableCoveragePercent: 0,
    framesAccepted: 0,
    framesRejected: 0,
  };
}

export class SessionService {
  private readonly emit: (event: MainEvent) => void;
  private readonly credentials: CredentialProvider;
  private readonly loadSdk: () => Promise<SmartSpectraModuleLike>;
  private readonly decodeMetrics: (buffer: Buffer | Uint8Array) => unknown;
  private readonly now: () => number;
  private readonly verboseValidationLogs: boolean;
  private readonly log: (level: 'info' | 'warn' | 'error', message: string) => void;

  private sdk: SmartSpectraSdkLike | null = null;
  private sdkModule: SmartSpectraModuleLike | null = null;
  private adapter: MetricsAdapter | null = null;
  private simulator: SignalSimulator | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot: SignalSnapshot | null = null;
  private lastFacts: SessionFacts | null = null;

  private phase: RuntimeStatus['phase'] = 'idle';
  private mode: Mode | null = null;
  private lastRequest: PrepareSessionRequest | null = null;
  private lastFrameTimestamp = 0;
  private consecutiveFrameFailures = 0;
  private decodeFailures = 0;

  constructor(deps: ServiceDependencies) {
    this.emit = deps.emit;
    this.credentials = deps.credentials;
    this.loadSdk = deps.loadSdk ?? loadDefaultSdk;
    this.decodeMetrics = deps.decodeMetrics ?? ((buffer) => decodeSdkMetrics(buffer));
    this.now = deps.now ?? Date.now;
    this.verboseValidationLogs = deps.verboseValidationLogs ?? false;
    this.log = deps.log ?? ((level, message) => console[level](`[LumaPause] ${message}`));
  }

  getEnvironment(): EnvironmentInfo {
    return this.credentials.getEnvironment();
  }

  getStatus(): RuntimeStatus {
    const env = this.credentials.getEnvironment();
    return {
      mode: this.mode,
      phase: this.phase,
      keyPresent: env.keyPresent,
      platformSupported: env.platformSupported,
      snapshot: this.lastSnapshot,
    };
  }

  private async loadSdkModule(): Promise<SmartSpectraModuleLike> {
    if (this.sdkModule) return this.sdkModule;
    this.sdkModule = await this.loadSdk();
    return this.sdkModule;
  }

  private requestedMetrics(expression: boolean): number[] {
    const metrics = [
      DEFAULT_METRICS.CHEST_BREATHING,
      DEFAULT_METRICS.BREATHING_RATE,
      DEFAULT_METRICS.PULSE_RATE,
    ];
    if (expression) metrics.push(DEFAULT_METRICS.EXPRESSIONS);
    return metrics;
  }

  private assertConsent(request: PrepareSessionRequest): void {
    if (
      !request.consent ||
      request.consent.granted !== true ||
      request.consent.version !== CONSENT_VERSION
    ) {
      throw new SessionFailure(consentRequiredError());
    }
  }

  private async teardownInternal(): Promise<void> {
    this.stopSnapshotTimer();
    this.simulator?.dispose();
    this.simulator = null;
    if (this.sdk) {
      try {
        await this.sdk.destroy();
      } catch {
        /* teardown is best-effort */
      }
    }
    this.sdk = null;
    this.adapter = null;
    this.lastSnapshot = null;
    this.phase = 'idle';
    this.mode = null;
    this.lastFrameTimestamp = 0;
    this.consecutiveFrameFailures = 0;
    this.decodeFailures = 0;
  }

  async prepareSession(request: PrepareSessionRequest): Promise<PrepareSessionResult> {
    this.assertConsent(request);
    const env = this.credentials.getEnvironment();

    if (request.mode === 'live') {
      if (!env.keyPresent) {
        throw new SessionFailure(
          mapSdkError(
            2,
            'SMARTSPECTRA_API_KEY is not present in the main process environment.',
            false,
          ),
        );
      }
      if (!env.platformSupported) {
        throw new SessionFailure(
          mapUnknownError(
            new Error(
              `SmartSpectra does not publish a native runtime for ${env.platform}-${env.arch}.`,
            ),
          ),
        );
      }
      if (env.nativeRuntimeError) {
        throw new SessionFailure(mapUnknownError(new Error(env.nativeRuntimeError)));
      }
    }

    await this.teardownInternal();

    this.mode = request.mode;
    this.lastRequest = request;
    this.adapter = new MetricsAdapter({
      mode: request.mode,
      expressionResponsiveness: request.expressionResponsiveness,
    });

    if (request.mode === 'live') {
      const apiKey = this.credentials.getApiKey();
      if (!apiKey) {
        throw new SessionFailure(
          mapSdkError(2, 'The API key was not available to the main process.', false),
        );
      }
      const module = await this.loadSdkModule();
      const ProcessingStatus = module.ProcessingStatus;
      this.adapter.setProcessing(processingFromCode(ProcessingStatus.kStarting ?? 2));

      const sdk = new module.SmartSpectraSDK({
        apiKey,
        requestedMetrics: this.requestedMetrics(request.consent.expression),
        enableTelemetry: false,
        enableAccumulatedOutput: false,
        // Native debug logs are invaluable for camera/frame pipeline failures in
        // local development. Packaged builds remain warning-only.
        logLevel: this.verboseValidationLogs
          ? (module.SmartSpectraLogLevel.kDebug ?? 0)
          : (module.SmartSpectraLogLevel.kWarning ?? 2),
      });

      sdk.on('metrics', (buf: unknown) => this.onMetrics(buf));
      sdk.on('validationStatus', (code: unknown, timestampUs: unknown, hint: unknown) =>
        this.onValidation(Number(code), Number(timestampUs), String(hint ?? '')),
      );
      sdk.on('processingStatus', (status: unknown) => this.onProcessing(Number(status)));
      sdk.on('error', (code: unknown, message: unknown, retryable: unknown) =>
        this.onSdkError(Number(code), String(message ?? ''), Boolean(retryable)),
      );
      sdk.useCustomInput(module.FrameTransform.kNone ?? 0);
      this.sdk = sdk;
      this.phase = 'prepared';
    } else {
      const scenario = request.scenario ?? 'stable';
      this.simulator = new SignalSimulator(scenario, {
        onMetrics: (metrics) => this.onSimulatedMetrics(metrics),
        onValidation: (code, timestampUs, hint) => this.onValidation(code, timestampUs, hint),
      });
      this.adapter.setProcessing(processingFromCode(1));
      this.phase = 'prepared';
    }

    return {
      mode: request.mode,
      processing: this.adapter.buildSnapshot(this.now()).processing,
      sdkVersion: this.credentials.getEnvironment().sdkVersion,
      expressionRequested: request.consent.expression,
    };
  }

  async startSession(): Promise<null> {
    if (this.phase !== 'prepared' || !this.adapter || !this.mode) {
      throw new SessionFailure(invalidStateError('The session has not been prepared.'));
    }
    const startedAt = this.now();
    this.adapter.markSessionStart(startedAt);
    this.lastFrameTimestamp = 0;
    this.consecutiveFrameFailures = 0;
    this.decodeFailures = 0;

    try {
      if (this.mode === 'live') {
        if (!this.sdk) throw new Error('SmartSpectra SDK is not constructed.');
        this.sdk.start();
      } else if (this.simulator) {
        this.simulator.start(startedAt);
      }
    } catch (error) {
      await this.teardownInternal();
      throw new SessionFailure(mapUnknownError(error, this.credentials.getApiKey()));
    }

    this.phase = 'running';
    this.startSnapshotTimer();
    this.emitSnapshot();
    return null;
  }

  async stopSession(): Promise<SessionFacts> {
    if (!this.adapter || !this.mode) {
      return this.lastFacts ?? zeroFacts('live');
    }
    if (this.phase !== 'prepared' && this.phase !== 'running' && this.phase !== 'stopping') {
      return this.lastFacts ?? zeroFacts(this.mode);
    }

    this.phase = 'stopping';
    this.stopSnapshotTimer();

    if (this.mode === 'live' && this.sdk) {
      try {
        await this.sdk.stopAsync();
      } catch (error) {
        this.log('warn', `stopAsync failed: ${mapUnknownError(error).message}`);
      }
    }
    this.simulator?.stop();
    this.detachSdkListeners();
    this.adapter.setProcessing(processingFromCode(1));

    const facts = this.adapter.getFacts(this.now());
    this.lastFacts = facts;
    // Camera-derived values leave memory now; reflection only needs scalar facts.
    this.adapter.clearSamples();
    this.lastSnapshot = null;
    this.phase = 'reflection';
    this.emit({ type: 'session-facts', facts });
    return facts;
  }

  async finishSession(): Promise<null> {
    await this.teardownInternal();
    this.lastRequest = null;
    this.lastFacts = null;
    this.emit({ type: 'cleared', at: this.now() });
    return null;
  }

  /** Replace native callbacks so no handler retains session state after stop. */
  private detachSdkListeners(): void {
    if (!this.sdk) return;
    const noop = (): void => undefined;
    for (const event of [
      'metrics',
      'validationStatus',
      'processingStatus',
      'error',
      'accumulatedMetrics',
      'frameSentThrough',
    ]) {
      try {
        this.sdk.on(event, noop);
      } catch {
        /* event may be unavailable on older bindings */
      }
    }
  }

  async retrySession(): Promise<PrepareSessionResult> {
    const request = this.lastRequest;
    if (!request) throw new SessionFailure(invalidStateError('There is no session to retry.'));
    await this.teardownInternal();
    if (request.mode === 'simulated') {
      return this.startDemo(request.scenario ?? 'stable', request.expressionResponsiveness);
    }
    return this.prepareSession(request);
  }

  async startDemo(
    scenario: SimulatorScenario,
    expressionResponsiveness: boolean,
  ): Promise<PrepareSessionResult> {
    const request: PrepareSessionRequest = {
      consent: {
        granted: true,
        version: CONSENT_VERSION,
        at: this.now(),
        camera: false,
        expression: expressionResponsiveness,
        simulator: true,
      },
      mode: 'simulated',
      expressionResponsiveness,
      scenario,
    };
    const prepared = await this.prepareSession(request);
    await this.startSession();
    return prepared;
  }

  async setScenario(scenario: SimulatorScenario): Promise<null> {
    if (this.mode !== 'simulated' || !this.simulator) {
      throw new SessionFailure(
        invalidStateError('Scenario switching is only available in demo mode.'),
      );
    }
    this.simulator.setScenario(scenario, this.now());
    return null;
  }

  async setExpressionResponsiveness(enabled: boolean): Promise<null> {
    if (!this.adapter) {
      throw new SessionFailure(invalidStateError('There is no prepared session.'));
    }
    this.adapter.setExpressionResponsiveness(enabled);
    if (this.lastRequest) this.lastRequest.expressionResponsiveness = enabled;
    return null;
  }

  async markRoomStart(): Promise<null> {
    if (!this.adapter) throw new SessionFailure(invalidStateError('There is no session.'));
    this.adapter.markRoomStart(this.now());
    return null;
  }

  /**
   * Count a frame that failed validation before it reached the SDK. No data is
   * retained; this only feeds the session's accepted/rejected frame counters.
   */
  recordRejectedFrame(): void {
    if (this.phase !== 'running') return;
    this.adapter?.recordFrame(false, this.now());
  }

  handleFrame(packet: FramePacket): boolean {
    if (this.phase !== 'running' || this.mode !== 'live' || !this.sdk || !this.adapter) {
      return false;
    }

    const timestamp = Math.floor(packet.timestampUs);
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      this.adapter.recordFrame(false, this.now());
      return false;
    }

    const expectedBytes = packet.stride * packet.height;
    if (
      packet.format !== 'rgba' ||
      packet.width < 16 ||
      packet.height < 16 ||
      packet.stride < packet.width * 4 ||
      packet.buffer.byteLength < expectedBytes
    ) {
      this.adapter.recordFrame(false, this.now());
      return false;
    }

    const monotonic =
      timestamp <= this.lastFrameTimestamp ? this.lastFrameTimestamp + 1 : timestamp;
    this.lastFrameTimestamp = monotonic;

    try {
      const module = this.sdkModule;
      if (!module) throw new Error('SmartSpectra module is not loaded.');
      const buffer = Buffer.from(packet.buffer);
      const sent = this.sdk.sendFrame(
        buffer,
        packet.width,
        packet.height,
        packet.stride,
        module.PixelFormat.kRGBA ?? 2,
        monotonic,
      );
      const accepted = sent !== false;
      this.adapter.recordFrame(accepted, this.now());
      if (accepted) {
        this.consecutiveFrameFailures = 0;
      } else {
        this.consecutiveFrameFailures += 1;
      }
      return accepted;
    } catch (error) {
      this.adapter.recordFrame(false, this.now());
      this.consecutiveFrameFailures += 1;
      if (this.consecutiveFrameFailures === 30) {
        this.emitFramePipelineError(error);
      }
      return false;
    }
  }

  private emitFramePipelineError(error: unknown): void {
    const info = mapUnknownError(error, this.credentials.getApiKey());
    info.code = 'FRAME_PIPELINE';
    info.title = 'Camera frames are not reaching the sensor';
    info.message = 'The local frame pipeline reported repeated conversion failures.';
    info.action = 'Retry the session or try another camera.';
    this.emit({ type: 'error', error: info });
    this.failActiveSession();
  }

  private onMetrics(raw: unknown): void {
    if (!this.adapter) return;
    if (!Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) return;
    try {
      const decoded = this.decodeMetrics(raw as Buffer | Uint8Array) as MetricsLike;
      this.adapter.handleMetrics(decoded, this.now());
      this.decodeFailures = 0;
    } catch (error) {
      this.decodeFailures += 1;
      this.log(
        'warn',
        `metrics decode failed (${this.decodeFailures}): ${mapUnknownError(error).message}`,
      );
    }
  }

  private onSimulatedMetrics(metrics: MetricsLike): void {
    this.adapter?.handleMetrics(metrics, this.now());
  }

  private onValidation(code: number, timestampUs: number, hint: string): void {
    if (!this.adapter) return;
    if (this.verboseValidationLogs) {
      this.log(
        'info',
        `validation code=${code} timestampUs=${timestampUs} hint=${JSON.stringify(hint)}`,
      );
    }
    this.adapter.setValidation(mapValidation(code, timestampUs, hint));
  }

  private onProcessing(code: number): void {
    if (!this.adapter) return;
    const processing: ProcessingState = processingFromCode(code);
    this.adapter.setProcessing(processing);
    this.emit({ type: 'processing', processing, at: this.now() });
  }

  private onSdkError(code: number, message: string, retryable: boolean): void {
    const info = mapSdkError(code, message, retryable, this.credentials.getApiKey());
    this.log('error', `SmartSpectra error ${code}: ${info.message}`);
    this.emit({ type: 'error', error: info });
    this.failActiveSession();
  }

  private failActiveSession(): void {
    this.stopSnapshotTimer();
    this.simulator?.stop();
    if (this.mode === 'live' && this.sdk) {
      void this.sdk.stopAsync().catch(() => undefined);
    }
    this.adapter?.clearSamples();
    this.lastSnapshot = null;
    this.phase = 'error';
  }

  private startSnapshotTimer(): void {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => this.emitSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  private stopSnapshotTimer(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private emitSnapshot(): void {
    if (this.phase !== 'running' || !this.adapter) return;
    const snapshot = this.adapter.buildSnapshot(this.now());
    this.lastSnapshot = snapshot;
    this.emit({ type: 'snapshot', snapshot });
  }

  async shutdown(): Promise<void> {
    await this.finishSession();
  }
}
