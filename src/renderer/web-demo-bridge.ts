import { CONSENT_VERSION, SNAPSHOT_INTERVAL_MS } from '../shared/constants';
import type {
  ApiResult,
  EnvironmentInfo,
  LumaPauseApi,
  MainEvent,
  PrepareSessionRequest,
  PrepareSessionResult,
  RuntimeStatus,
  SessionErrorInfo,
  SessionFacts,
  SignalSnapshot,
  SimulatorScenario,
} from '../shared/contracts';
import { mapValidation } from '../shared/validation-guidance';
import { MetricsAdapter, processingFromCode } from '../main/smartspectra/metrics-adapter';
import { SignalSimulator } from '../simulator/signal-simulator';

const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });

const liveUnavailable = (): ApiResult<never> => ({
  ok: false,
  error: {
    code: 'DESKTOP_REQUIRED',
    kind: 'recoverable',
    title: 'Live sensing requires the desktop app',
    message: 'The SmartSpectra Node SDK uses a native runtime that cannot run on Vercel.',
    action: 'Use the clearly labelled online simulator, or run the desktop application.',
    retryable: false,
    sdkCode: null,
    at: Date.now(),
  } satisfies SessionErrorInfo,
});

/** Browser-only implementation of the preload contract for the public site. */
export function createWebDemoBridge(): LumaPauseApi {
  const listeners = new Set<(event: MainEvent) => void>();
  const emit = (event: MainEvent): void => listeners.forEach((listener) => listener(event));
  let adapter: MetricsAdapter | null = null;
  let simulator: SignalSimulator | null = null;
  let snapshot: SignalSnapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let scenario: SimulatorScenario = 'stable';
  let expressionResponsive = true;
  let phase: RuntimeStatus['phase'] = 'idle';

  const environment: EnvironmentInfo = {
    appVersion: '1.0.0-web',
    sdkVersion: null,
    platform: 'web',
    arch: 'browser',
    platformSupported: false,
    keyPresent: false,
    keySource: 'missing',
    simulatorAvailable: true,
    telemetryDisabled: true,
    telemetryNote: 'SmartSpectra is not loaded by the browser experience.',
    nativeRuntimeError: null,
    consentVersion: CONSENT_VERSION,
    timingScale: 1,
  };

  const stopTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const startSnapshots = (): void => {
    stopTimer();
    timer = setInterval(() => {
      if (!adapter || phase !== 'running') return;
      snapshot = adapter.buildSnapshot(Date.now());
      emit({ type: 'snapshot', snapshot });
    }, SNAPSHOT_INTERVAL_MS);
  };

  const dispose = (): void => {
    stopTimer();
    simulator?.dispose();
    simulator = null;
    adapter = null;
    snapshot = null;
    phase = 'idle';
  };

  const startDemo = (
    nextScenario: SimulatorScenario,
    nextExpressionResponsive: boolean,
  ): PrepareSessionResult => {
    dispose();
    scenario = nextScenario;
    expressionResponsive = nextExpressionResponsive;
    adapter = new MetricsAdapter({
      mode: 'simulated',
      expressionResponsiveness: expressionResponsive,
    });
    adapter.markSessionStart(Date.now());
    adapter.setProcessing(processingFromCode(3));
    simulator = new SignalSimulator(scenario, {
      onMetrics: (metrics) => adapter?.handleMetrics(metrics, Date.now()),
      onValidation: (code, timestampUs, hint) =>
        adapter?.setValidation(mapValidation(code, timestampUs, hint)),
    });
    simulator.start();
    phase = 'running';
    startSnapshots();
    emit({ type: 'demo-ready', at: Date.now() });
    return {
      mode: 'simulated',
      processing: processingFromCode(3),
      sdkVersion: null,
      expressionRequested: expressionResponsive,
    };
  };

  return {
    getEnvironment: async () => environment,
    getStatus: async () => ({
      mode: adapter ? 'simulated' : null,
      phase,
      keyPresent: false,
      platformSupported: false,
      snapshot,
    }),
    prepareSession: async (_request: PrepareSessionRequest) => liveUnavailable(),
    startSession: async () => liveUnavailable(),
    stopSession: async () => {
      const facts = adapter?.getFacts(Date.now()) ?? {
        mode: 'simulated' as const,
        durationMs: 0,
        roomDurationMs: 0,
        calibrationDurationMs: 0,
        signalsAvailable: { pulse: false, breathing: false, expression: false },
        stableCoveragePercent: 0,
        framesAccepted: 0,
        framesRejected: 0,
      };
      stopTimer();
      simulator?.stop();
      adapter?.clearSamples();
      phase = 'reflection';
      emit({ type: 'session-facts', facts });
      return ok<SessionFacts>(facts);
    },
    finishSession: async () => {
      dispose();
      emit({ type: 'cleared', at: Date.now() });
      return ok(null);
    },
    retrySession: async () => ok(startDemo(scenario, expressionResponsive)),
    startDemo: async (nextScenario, nextExpressionResponsive) =>
      ok(startDemo(nextScenario, nextExpressionResponsive)),
    setScenario: async (nextScenario) => {
      scenario = nextScenario;
      simulator?.setScenario(nextScenario);
      return ok(null);
    },
    setExpressionResponsiveness: async (enabled) => {
      expressionResponsive = enabled;
      adapter?.setExpressionResponsiveness(enabled);
      return ok(null);
    },
    markRoomStart: async () => {
      adapter?.markRoomStart(Date.now());
      return ok(null);
    },
    attachFramePort: () => undefined,
    sendFrame: () => undefined,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
