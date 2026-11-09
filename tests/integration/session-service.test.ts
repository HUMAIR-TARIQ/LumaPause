import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_VERSION } from '../../src/shared/constants';
import type {
  ConsentRecord,
  EnvironmentInfo,
  MainEvent,
  PrepareSessionRequest,
  SignalSnapshot,
} from '../../src/shared/contracts';
import {
  SessionService,
  type FramePacket,
  type ServiceDependencies,
  type SmartSpectraModuleLike,
  type SmartSpectraSdkLike,
} from '../../src/main/smartspectra/service';
import type { MetricsLike } from '../../src/main/smartspectra/metrics-adapter';

const START = new Date('2026-11-09T12:00:00Z').getTime();
const KEY = 'sk-test-unique-lumapause-key-987654';

type Listener = (...args: unknown[]) => void;

class FakeSdk implements SmartSpectraSdkLike {
  static instances: FakeSdk[] = [];

  readonly options: Record<string, unknown>;
  readonly listeners = new Map<string, Listener[]>();
  readonly frames: Array<{
    buffer: Uint8Array;
    width: number;
    height: number;
    stride: number;
    pixelFormat: number;
    timestampUs: number;
  }> = [];
  customInput: number | null = null;
  started = false;
  stopped = false;
  destroyed = false;
  failFrames = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeSdk.instances.push(this);
  }

  on(event: string, callback: Listener): this {
    const current = this.listeners.get(event) ?? [];
    current.push(callback);
    this.listeners.set(event, current);
    return this;
  }

  useCustomInput(transform?: number): this {
    this.customInput = transform ?? null;
    return this;
  }

  start(): void {
    this.started = true;
  }

  async stopAsync(): Promise<void> {
    this.stopped = true;
  }

  reset(): void {
    /* no-op for the fake */
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  sendFrame(
    buffer: Uint8Array,
    width: number,
    height: number,
    stride: number,
    pixelFormat: number,
    timestampUs: number,
  ): boolean {
    if (this.failFrames) throw new Error('native frame conversion failed');
    this.frames.push({ buffer, width, height, stride, pixelFormat, timestampUs });
    return true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const callback of this.listeners.get(event) ?? []) callback(...args);
  }
}

const moduleUnderTest: SmartSpectraModuleLike = {
  SmartSpectraSDK: FakeSdk as unknown as SmartSpectraModuleLike['SmartSpectraSDK'],
  ProcessingStatus: {
    kUninitialized: 0,
    kIdle: 1,
    kStarting: 2,
    kRunning: 3,
    kStopping: 4,
    kError: 5,
  },
  PixelFormat: { kRGBA: 2 },
  MetricType: { CHEST_BREATHING: 0, BREATHING_RATE: 2, EXPRESSIONS: 14, PULSE_RATE: 15 },
  SmartSpectraLogLevel: { kWarning: 2 },
  FrameTransform: { kNone: 0 },
};

function consent(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    granted: true,
    version: CONSENT_VERSION,
    at: START,
    camera: true,
    expression: false,
    simulator: false,
    ...overrides,
  };
}

function liveRequest(overrides: Partial<PrepareSessionRequest> = {}): PrepareSessionRequest {
  return {
    consent: consent(),
    mode: 'live',
    expressionResponsiveness: false,
    ...overrides,
  };
}

function environment(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    appVersion: '1.0.0',
    sdkVersion: '3.4.0',
    platform: 'win32',
    arch: 'x64',
    platformSupported: true,
    keyPresent: true,
    keySource: 'environment',
    simulatorAvailable: true,
    telemetryDisabled: true,
    telemetryNote: 'disabled',
    nativeRuntimeError: null,
    consentVersion: CONSENT_VERSION,
    timingScale: 1,
    ...overrides,
  };
}

function metrics(now: number, overrides: Partial<MetricsLike> = {}): MetricsLike {
  const stamp = now * 1_000;
  return {
    cardio: {
      pulseRate: [{ value: 66, confidence: 70, stable: true, timestamp: stamp }],
    },
    breathing: {
      rate: [{ value: 13, confidence: 70, stable: true, timestamp: stamp }],
      upperTrace: [
        { value: 0, stable: true, timestamp: stamp },
        { value: 1, stable: true, timestamp: stamp + 1 },
      ],
    },
    ...overrides,
  };
}

interface Harness {
  service: SessionService;
  events: MainEvent[];
  clock: { t: number };
  env: EnvironmentInfo;
  setKey: (key: string | null) => void;
  advance: (ms: number) => void;
  latestSnapshot: () => SignalSnapshot | null;
  lastEvent: <T extends MainEvent['type']>(type: T) => Extract<MainEvent, { type: T }> | null;
}

function setup(
  options: {
    env?: Partial<EnvironmentInfo>;
    key?: string | null;
    decoded?: (now: number) => MetricsLike;
  } = {},
): Harness {
  const clock = { t: START };
  let key = options.key === undefined ? KEY : options.key;
  let env = environment({ ...options.env, keyPresent: key !== null });
  const events: MainEvent[] = [];
  const deps: ServiceDependencies = {
    emit: (event) => events.push(event),
    credentials: {
      getApiKey: () => key,
      getEnvironment: () => env,
    },
    loadSdk: async () => moduleUnderTest,
    decodeMetrics: () => (options.decoded ?? ((now: number) => metrics(now)))(clock.t),
    now: () => clock.t,
    log: () => undefined,
  };
  const service = new SessionService(deps);
  return {
    service,
    events,
    clock,
    env,
    setKey: (next) => {
      key = next;
      env = environment({ ...options.env, keyPresent: next !== null });
    },
    advance: (ms) => {
      clock.t += ms;
      vi.advanceTimersByTime(ms);
    },
    latestSnapshot: () => {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'snapshot') return event.snapshot;
      }
      return null;
    },
    lastEvent: (type) => {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === type) {
          return event as Extract<MainEvent, { type: typeof type }>;
        }
      }
      return null;
    },
  };
}

function packet(overrides: Partial<FramePacket> = {}): FramePacket {
  const width = 16;
  const height = 16;
  const stride = width * 4;
  return {
    width,
    height,
    stride,
    format: 'rgba',
    timestampUs: START * 1_000,
    buffer: new ArrayBuffer(stride * height),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  FakeSdk.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionService consent and preparation', () => {
  it('refuses a session without deliberate, current consent and never loads the SDK', async () => {
    const { service } = setup();

    await expect(
      service.prepareSession(liveRequest({ consent: consent({ granted: false as true }) })),
    ).rejects.toMatchObject({ info: { code: 'CONSENT_REQUIRED' } });
    await expect(
      service.prepareSession(liveRequest({ consent: consent({ version: '2020-01-01' }) })),
    ).rejects.toMatchObject({ info: { code: 'CONSENT_REQUIRED' } });
    await expect(
      service.prepareSession({ ...liveRequest(), consent: null as unknown as ConsentRecord }),
    ).rejects.toMatchObject({ info: { code: 'CONSENT_REQUIRED' } });

    expect(FakeSdk.instances).toHaveLength(0);
  });

  it('refuses live mode without a main-process key', async () => {
    const { service } = setup({ key: null });
    await expect(service.prepareSession(liveRequest())).rejects.toMatchObject({
      info: { code: 'AUTH_FAILED', kind: 'fatal' },
    });
    expect(FakeSdk.instances).toHaveLength(0);
  });

  it('refuses live mode on an unsupported platform', async () => {
    const { service } = setup({
      env: { platform: 'darwin', arch: 'x64', platformSupported: false },
    });
    await expect(service.prepareSession(liveRequest())).rejects.toMatchObject({
      info: { code: 'UNEXPECTED_ERROR' },
    });
    expect(FakeSdk.instances).toHaveLength(0);
  });

  it('constructs the SDK in the main process with telemetry off and a key that never reaches events', async () => {
    const { service, events } = setup();
    const prepared = await service.prepareSession(liveRequest());
    expect(prepared).toMatchObject({
      mode: 'live',
      expressionRequested: false,
      sdkVersion: '3.4.0',
    });

    expect(FakeSdk.instances).toHaveLength(1);
    const sdk = FakeSdk.instances[0]!;
    expect(sdk.options.apiKey).toBe(KEY);
    expect(sdk.options.enableTelemetry).toBe(false);
    expect(sdk.options.enableAccumulatedOutput).toBe(false);
    expect(sdk.options.requestedMetrics).toEqual([0, 2, 15]);
    expect(sdk.customInput).toBe(0);
    expect(sdk.started).toBe(false);

    await service.startSession();
    expect(sdk.started).toBe(true);
    expect(events.some((event) => event.type === 'snapshot')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('requests expression metrics only with consent', async () => {
    const { service } = setup();
    await service.prepareSession(
      liveRequest({
        consent: consent({ expression: true }),
        expressionResponsiveness: true,
      }),
    );
    expect(FakeSdk.instances[0]?.options.requestedMetrics).toEqual([0, 2, 15, 14]);
  });

  it('rejects lifecycle calls before a session exists', async () => {
    const { service } = setup();
    await expect(service.startSession()).rejects.toMatchObject({
      info: { code: 'INVALID_STATE' },
    });
    await expect(service.markRoomStart()).rejects.toMatchObject({
      info: { code: 'INVALID_STATE' },
    });
    await expect(service.setExpressionResponsiveness(true)).rejects.toMatchObject({
      info: { code: 'INVALID_STATE' },
    });
  });
});

describe('SessionService live lifecycle', () => {
  it('emits live snapshots and clears samples, snapshot state and SDK frames on stop', async () => {
    const { service, events, advance, latestSnapshot } = setup();
    await service.prepareSession(liveRequest());
    await service.startSession();
    const sdk = FakeSdk.instances[0]!;

    sdk.emit('metrics', Buffer.from([1, 2, 3]));
    advance(100);
    const live = latestSnapshot();
    expect(live?.mode).toBe('live');
    expect(live?.visual.measuredPulse).toBe(true);
    expect(live?.visual.measuredBreathing).toBe(true);

    expect(service.handleFrame(packet())).toBe(true);
    expect(sdk.frames).toHaveLength(1);
    expect(sdk.frames[0]).toMatchObject({ pixelFormat: 2, width: 16, height: 16 });

    const repeated = packet();
    expect(service.handleFrame(repeated)).toBe(true);
    expect(sdk.frames[1]?.timestampUs).toBe(sdk.frames[0]!.timestampUs + 1);

    expect(service.handleFrame(packet({ format: 'bgra' as 'rgba' }))).toBe(false);
    expect(service.handleFrame(packet({ buffer: new ArrayBuffer(10) }))).toBe(false);

    const facts = await service.stopSession();
    expect(facts.mode).toBe('live');
    expect(facts.signalsAvailable.pulse).toBe(true);
    expect(sdk.stopped).toBe(true);
    expect(service.getStatus().snapshot).toBeNull();
    expect(service.getStatus().phase).toBe('reflection');
    expect(service.handleFrame(packet())).toBe(false);

    const snapshotCount = events.filter((event) => event.type === 'snapshot').length;
    advance(500);
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(snapshotCount);

    await service.finishSession();
    expect(sdk.destroyed).toBe(true);
    expect(service.getStatus()).toMatchObject({ phase: 'idle', mode: null, snapshot: null });
  });

  it('streams validation and processing states into snapshots without inventing readings', async () => {
    const { service, advance, latestSnapshot, lastEvent } = setup();
    await service.prepareSession(liveRequest());
    await service.startSession();
    const sdk = FakeSdk.instances[0]!;

    sdk.emit('validationStatus', 5, START * 1_000, 'scene too dark');
    sdk.emit('processingStatus', 3);
    advance(100);

    expect(lastEvent('processing')?.processing.label).toBe('Running');
    const snapshot = latestSnapshot();
    expect(snapshot?.validation).toMatchObject({
      code: 5,
      label: 'Light looks low',
      officialHint: 'scene too dark',
    });
    expect(snapshot?.visual.measuredPulse).toBe(false);
    expect(snapshot?.visual.signalAvailability).toBe('none');
  });

  it('turns an SDK failure into a redacted error, clears the snapshot and retries', async () => {
    const { service, events, lastEvent } = setup();
    await service.prepareSession(liveRequest());
    await service.startSession();
    const first = FakeSdk.instances[0]!;

    first.emit('error', 5, `network failed for ${KEY}`, true);
    const error = lastEvent('error');
    expect(error?.error).toMatchObject({
      code: 'NETWORK_ERROR',
      kind: 'recoverable',
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(service.getStatus().phase).toBe('error');
    expect(service.getStatus().snapshot).toBeNull();
    expect(JSON.stringify(events)).not.toContain(KEY);

    await service.retrySession();
    expect(FakeSdk.instances).toHaveLength(2);
    expect(FakeSdk.instances[1]?.options.apiKey).toBe(KEY);
    expect(service.getStatus().phase).toBe('prepared');
    expect(service.getStatus().snapshot).toBeNull();
  });

  it('reports a repeated native frame failure once and fails the active session', async () => {
    const { service, lastEvent } = setup();
    await service.prepareSession(liveRequest());
    await service.startSession();
    const sdk = FakeSdk.instances[0]!;
    sdk.failFrames = true;

    for (let index = 0; index < 30; index += 1) {
      service.handleFrame(packet({ timestampUs: START * 1_000 + index + 1 }));
    }

    const error = lastEvent('error');
    expect(error?.error.code).toBe('FRAME_PIPELINE');
    expect(service.getStatus().phase).toBe('error');
  });

  it('rejects scenario switching in live mode while keeping live frames flowing', async () => {
    const { service } = setup();
    await service.prepareSession(liveRequest());
    await service.startSession();
    await expect(service.setScenario('motion')).rejects.toMatchObject({
      info: { code: 'INVALID_STATE' },
    });
    expect(service.handleFrame(packet())).toBe(true);
  });
});

describe('SessionService simulator lifecycle', () => {
  it('runs simulated signals without loading the worker SDK or accepting frames', async () => {
    const { service, advance, latestSnapshot } = setup();
    const prepared = await service.startDemo('stable', true);

    expect(prepared.mode).toBe('simulated');
    expect(FakeSdk.instances).toHaveLength(0);
    expect(service.getStatus()).toMatchObject({ phase: 'running', mode: 'simulated' });
    expect(latestSnapshot()?.mode).toBe('simulated');
    expect(service.handleFrame(packet())).toBe(false);

    advance(5_000);
    const snapshot = latestSnapshot();
    expect(snapshot?.mode).toBe('simulated');
    expect(snapshot?.visual.measuredPulse).toBe(true);
    expect(snapshot?.visual.measuredBreathing).toBe(true);
    expect(snapshot?.visual.signalAvailability).toBe('ready');
  });

  it('switches scenarios only in demo mode and keeps the simulated label', async () => {
    const { service, advance, latestSnapshot } = setup();
    await service.startDemo('stable', false);
    advance(3_000);
    await service.setScenario('poor_lighting');
    advance(1_000);
    const snapshot = latestSnapshot();
    expect(snapshot?.mode).toBe('simulated');
    expect(snapshot?.validation?.code).toBe(5);
    expect(snapshot?.visual.signalAvailability).toBe('none');
  });

  it('stops and clears a demo without destroying a live SDK', async () => {
    const { service, advance, lastEvent } = setup();
    await service.startDemo('motion', false);
    advance(2_500);
    const facts = await service.stopSession();
    expect(facts.mode).toBe('simulated');
    expect(service.getStatus().snapshot).toBeNull();
    expect(lastEvent('session-facts')?.facts.mode).toBe('simulated');

    await service.finishSession();
    expect(lastEvent('cleared')).not.toBeNull();
    expect(service.getStatus()).toMatchObject({
      phase: 'idle',
      mode: null,
      snapshot: null,
    });
  });

  it('marks the room start only after an explicit call', async () => {
    const { service, advance, latestSnapshot } = setup();
    await service.startDemo('stable', false);
    advance(1_000);
    expect(latestSnapshot()?.roomElapsedMs).toBe(0);
    await service.markRoomStart();
    advance(1_000);
    expect(latestSnapshot()?.roomElapsedMs).toBe(1_000);
  });
});
