/**
 * Shared contracts between the Electron main process, preload bridge and renderer.
 *
 * Nothing in this file contains credentials or raw camera data types that cross
 * the process boundary. Frame buffers use a private MessagePort, not IPC events.
 */

export type Mode = 'live' | 'simulated';

export type SessionPhase =
  | 'welcome'
  | 'consent'
  | 'setup_required'
  | 'requesting_camera'
  | 'validating_input'
  | 'calibrating'
  | 'ready'
  | 'partial_signal_continue'
  | 'demo'
  | 'active.arrive'
  | 'active.settle'
  | 'active.choose'
  | 'stopping'
  | 'reflection'
  | 'clearing'
  | 'permission_denied'
  | 'recoverable_error'
  | 'fatal_error';

export type SignalAvailability = 'none' | 'partial' | 'ready';

export type ValidationLevel = 'clear' | 'guidance' | 'blocking' | 'unknown';

/** A single physiological sample after validation and normalisation. */
export interface SignalSample {
  /** Measured value. Units are documented per signal in SIGNAL_UNITS. */
  value: number;
  /** Official model confidence, 0-100. For traces this mirrors the parent rate verdict. */
  confidence: number;
  /** Official stability flag from the SDK payload. */
  stable: boolean;
  /** Sample time in milliseconds since Unix epoch (converted from the payload's microseconds). */
  timestamp: number;
  /** Optional rolling 0..1 position for waveform traces. Computed locally, never part of the SDK payload. */
  normalized?: number;
}

export interface ExpressionState {
  /** Raw model probabilities by expression name. Never shown as a judgement in the public UI. */
  probabilities: Record<string, number>;
  dominant: string | null;
  dominantConfidence: number;
  stable: boolean;
  timestamp: number;
}

export interface ValidationState {
  /** Original SDK ValidationCode value, preserved for developer logging. */
  code: number;
  label: string;
  /** Short, human-friendly guidance derived from the official code. */
  hint: string;
  /** Verbatim SDK hint, preserved for the developer overlay and logs. */
  officialHint: string;
  level: ValidationLevel;
  /** Original SDK timestamp in microseconds since Unix epoch. */
  timestampUs: number;
}

export type ProcessingLabel =
  | 'Uninitialised'
  | 'Idle'
  | 'Starting'
  | 'Running'
  | 'Stopping'
  | 'Error';

export interface ProcessingState {
  code: number;
  label: ProcessingLabel;
}

export interface VisualState {
  /** Central orb scale multiplier, 0.9 - 1.1. */
  breathScale: number;
  /** Ring/particle luminance, 0.1 - 1. */
  pulseGlow: number;
  /** Particle drift speed, 0 - 1. */
  particleVelocity: number;
  /** Palette warmth, 0 (cool mint) - 1 (amber). */
  paletteWarmth: number;
  /** Breathing cycle period in ms when measured, otherwise null (ambient). */
  breathingPeriodMs: number | null;
  /** True only when a stable, fresh breathing waveform is driving the orb. */
  measuredBreathing: boolean;
  /** True only when a stable, fresh pulse sample is present. */
  measuredPulse: boolean;
  signalAvailability: SignalAvailability;
}

export interface FrameStats {
  received: number;
  accepted: number;
  rejected: number;
  fps: number;
  lastFrameAt: number | null;
}

export interface StableCoverage {
  percent: number;
  stableSeconds: number;
  observedSeconds: number;
}

export interface SignalSnapshot {
  mode: Mode;
  revision: number;
  emittedAt: number;
  /** Milliseconds since the SDK/demo session started. */
  sessionElapsedMs: number;
  /** Milliseconds since the responsive room started, or 0. */
  roomElapsedMs: number;
  pulse: SignalSample | null;
  breathingRate: SignalSample | null;
  upperBreathingWaveform: SignalSample | null;
  expression: ExpressionState | null;
  validation: ValidationState | null;
  processing: ProcessingState;
  visual: VisualState;
  expressionResponsiveness: boolean;
  frameStats: FrameStats;
  stableCoverage: StableCoverage;
  signalsEverAvailable: {
    pulse: boolean;
    breathing: boolean;
    expression: boolean;
  };
}

export interface SessionFacts {
  mode: Mode;
  durationMs: number;
  roomDurationMs: number;
  calibrationDurationMs: number;
  signalsAvailable: {
    pulse: boolean;
    breathing: boolean;
    expression: boolean;
  };
  stableCoveragePercent: number;
  framesAccepted: number;
  framesRejected: number;
}

export interface ConsentRecord {
  granted: true;
  /** Version of the consent copy the user agreed to. */
  version: string;
  /** Epoch ms of the deliberate consent action. */
  at: number;
  camera: boolean;
  expression: boolean;
  simulator: boolean;
}

export type SimulatorScenario =
  | 'stable'
  | 'poor_lighting'
  | 'motion'
  | 'partial_signal'
  | 'signal_loss';

export interface PrepareSessionRequest {
  consent: ConsentRecord;
  mode: Mode;
  expressionResponsiveness: boolean;
  scenario?: SimulatorScenario;
}

export interface PrepareSessionResult {
  mode: Mode;
  processing: ProcessingState;
  sdkVersion: string | null;
  expressionRequested: boolean;
}

export interface EnvironmentInfo {
  appVersion: string;
  sdkVersion: string | null;
  platform: string;
  arch: string;
  platformSupported: boolean;
  keyPresent: boolean;
  keySource: 'environment' | 'dotenv' | 'missing';
  simulatorAvailable: true;
  telemetryDisabled: true;
  telemetryNote: string;
  nativeRuntimeError: string | null;
  consentVersion: string;
  /**
   * Multiplier for calibration and room timings. Always 1 in production.
   * Automated Electron tests use a smaller value to walk the real state flow
   * without waiting three minutes; signals still must meet the same thresholds.
   */
  timingScale: number;
}

export interface SessionErrorInfo {
  code: string;
  kind: 'recoverable' | 'fatal';
  title: string;
  message: string;
  action: string;
  retryable: boolean;
  sdkCode: number | null;
  at: number;
}

export type MainEvent =
  | { type: 'snapshot'; snapshot: SignalSnapshot }
  | { type: 'processing'; processing: ProcessingState; at: number }
  | { type: 'error'; error: SessionErrorInfo }
  | { type: 'session-facts'; facts: SessionFacts }
  | { type: 'cleared'; at: number }
  | { type: 'demo-ready'; at: number };

export interface RuntimeStatus {
  mode: Mode | null;
  phase: 'idle' | 'prepared' | 'running' | 'stopping' | 'reflection' | 'error';
  keyPresent: boolean;
  platformSupported: boolean;
  snapshot: SignalSnapshot | null;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: SessionErrorInfo };

export interface FramePacketHeader {
  width: number;
  height: number;
  stride: number;
  format: 'rgba';
  timestampUs: number;
}

/** Public preload surface. Never expose ipcRenderer or Node primitives. */
export interface LumaPauseApi {
  getEnvironment(): Promise<EnvironmentInfo>;
  getStatus(): Promise<RuntimeStatus>;
  prepareSession(request: PrepareSessionRequest): Promise<ApiResult<PrepareSessionResult>>;
  startSession(): Promise<ApiResult<null>>;
  stopSession(): Promise<ApiResult<SessionFacts>>;
  finishSession(): Promise<ApiResult<null>>;
  retrySession(): Promise<ApiResult<PrepareSessionResult>>;
  startDemo(
    scenario: SimulatorScenario,
    expressionResponsiveness: boolean,
  ): Promise<ApiResult<PrepareSessionResult>>;
  setScenario(scenario: SimulatorScenario): Promise<ApiResult<null>>;
  setExpressionResponsiveness(enabled: boolean): Promise<ApiResult<null>>;
  markRoomStart(): Promise<ApiResult<null>>;
  attachFramePort(): void;
  sendFrame(header: FramePacketHeader, buffer: ArrayBuffer): void;
  onEvent(listener: (event: MainEvent) => void): () => void;
}

export const SIGNAL_UNITS = {
  pulse: 'bpm',
  breathingRate: 'br/min',
  breathingWaveform: 'relative chest movement (unitless)',
} as const;

export const EXPRESSION_NAMES: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'ANGRY',
  2: 'CONTEMPT',
  3: 'DISGUST',
  4: 'FEAR',
  5: 'HAPPY',
  6: 'NEUTRAL',
  7: 'SAD',
  8: 'SURPRISE',
};
