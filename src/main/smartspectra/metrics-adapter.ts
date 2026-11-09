import {
  COVERAGE_BIN_MS,
  MAX_COVERAGE_BINS,
  MAX_WAVEFORM_SAMPLES,
  WAVEFORM_WINDOW_MS,
} from '../../shared/constants';
import {
  EXPRESSION_NAMES,
  type ExpressionState,
  type FrameStats,
  type Mode,
  type ProcessingLabel,
  type ProcessingState,
  type SessionFacts,
  type SignalSample,
  type SignalSnapshot,
  type ValidationState,
} from '../../shared/contracts';
import {
  expressionIsEligible,
  mapSignalsToVisual,
  usableBreathing,
  usablePulse,
} from '../../shared/visual-mapping';

/**
 * Structural subset of the generated SmartSpectra Metrics protobuf message.
 * Keeping this local makes the adapter testable without the native runtime.
 */
export interface RawMeasurement {
  value?: unknown;
  stable?: unknown;
  confidence?: unknown;
  timestamp?: unknown;
}

export interface RawExpressionScore {
  type?: unknown;
  confidence?: unknown;
}

export interface RawExpression {
  stable?: unknown;
  timestamp?: unknown;
  scores?: RawExpressionScore[] | null;
}

export interface MetricsLike {
  breathing?: {
    rate?: RawMeasurement[] | null;
    upperTrace?: RawMeasurement[] | null;
  } | null;
  cardio?: {
    pulseRate?: RawMeasurement[] | null;
  } | null;
  face?: {
    expression?: RawExpression[] | null;
  } | null;
}

const PROCESSING_LABELS: Record<number, ProcessingLabel> = {
  0: 'Uninitialised',
  1: 'Idle',
  2: 'Starting',
  3: 'Running',
  4: 'Stopping',
  5: 'Error',
};

export function processingFromCode(code: number): ProcessingState {
  return { code, label: PROCESSING_LABELS[code] ?? 'Uninitialised' };
}

/**
 * protobufjs int64 fields can arrive as a number or a Long-like object.
 * Returns epoch milliseconds, or NaN when the timestamp is unusable.
 */
export function timestampMicrosToMillis(raw: unknown): number {
  let micros = NaN;
  if (typeof raw === 'number') {
    micros = raw;
  } else if (typeof raw === 'bigint') {
    micros = Number(raw);
  } else if (raw && typeof raw === 'object') {
    const candidate = raw as { toNumber?: () => number; low?: number; high?: number };
    if (typeof candidate.toNumber === 'function') {
      micros = candidate.toNumber();
    } else if (typeof candidate.low === 'number' && typeof candidate.high === 'number') {
      micros = (candidate.high >>> 0) * 4_294_967_296 + (candidate.low >>> 0);
    }
  }
  if (!Number.isFinite(micros) || micros <= 0) return NaN;
  return micros / 1_000;
}

function finiteNumber(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function readLatestMeasurement(
  samples: RawMeasurement[] | null | undefined,
  nowMs: number,
): SignalSample | null {
  const latest = samples?.at(-1);
  if (!latest) return null;
  const value = finiteNumber(latest.value);
  if (value === null) return null;
  const confidence = finiteNumber(latest.confidence);
  const timestamp = timestampMicrosToMillis(latest.timestamp);
  return {
    value,
    confidence: Math.min(100, Math.max(0, confidence ?? 0)),
    stable: latest.stable === true,
    timestamp: Number.isFinite(timestamp) ? timestamp : nowMs,
  };
}

export function readLatestExpression(
  expressions: RawExpression[] | null | undefined,
  nowMs: number,
): ExpressionState | null {
  const latest = expressions?.at(-1);
  if (!latest) return null;
  const probabilities: Record<string, number> = {};
  for (const score of latest.scores ?? []) {
    const typeCode = finiteNumber(score.type);
    const confidence = finiteNumber(score.confidence);
    if (typeCode === null || confidence === null) continue;
    const name = EXPRESSION_NAMES[typeCode] ?? 'UNSPECIFIED';
    const clamped = Math.min(100, Math.max(0, confidence));
    probabilities[name] = Math.max(probabilities[name] ?? 0, clamped);
  }
  let dominant: string | null = null;
  let dominantConfidence = 0;
  for (const [name, confidence] of Object.entries(probabilities)) {
    if (confidence > dominantConfidence) {
      dominant = name;
      dominantConfidence = confidence;
    }
  }
  const timestamp = timestampMicrosToMillis(latest.timestamp);
  return {
    probabilities,
    dominant,
    dominantConfidence,
    stable: latest.stable === true,
    timestamp: Number.isFinite(timestamp) ? timestamp : nowMs,
  };
}

/**
 * Bounded rolling min/max normaliser for the relative chest-movement trace.
 * The trace's unit is not calibrated, so the orb responds to position within
 * a short recent window rather than to an absolute threshold.
 */
export class WaveformWindow {
  private samples: Array<{ value: number; timestamp: number }> = [];
  private smoothed = 0.5;

  add(value: number, timestamp: number): void {
    if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return;
    this.samples.push({ value, timestamp });
    const cutoff = timestamp - WAVEFORM_WINDOW_MS;
    while (this.samples.length > 0 && (this.samples[0]?.timestamp ?? 0) < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length > MAX_WAVEFORM_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_WAVEFORM_SAMPLES);
    }
    this.smoothed = this.positionFor(value);
  }

  private positionFor(value: number): number {
    if (this.samples.length < 2) return 0.5;
    let min = Infinity;
    let max = -Infinity;
    for (const sample of this.samples) {
      if (sample.value < min) min = sample.value;
      if (sample.value > max) max = sample.value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
      return 0.5;
    }
    const target = (value - min) / (max - min);
    return this.smoothed + (target - this.smoothed) * 0.25;
  }

  get position(): number {
    return Math.min(1, Math.max(0, this.smoothed));
  }

  get size(): number {
    return this.samples.length;
  }

  reset(): void {
    this.samples = [];
    this.smoothed = 0.5;
  }
}

export interface MetricsAdapterOptions {
  mode: Mode;
  expressionResponsiveness: boolean;
}

export class MetricsAdapter {
  readonly mode: Mode;
  private expressionResponsiveness: boolean;

  private pulse: SignalSample | null = null;
  private breathingRate: SignalSample | null = null;
  private waveform: SignalSample | null = null;
  private expression: ExpressionState | null = null;
  private validation: ValidationState | null = null;
  private processing: ProcessingState = { code: 0, label: 'Uninitialised' };

  private sessionStartMs = 0;
  private roomStartMs = 0;
  private revision = 0;
  private lastWaveformTimestamp = 0;

  private readonly waveformWindow = new WaveformWindow();
  private coverageBins: boolean[] = [];
  private ever = { pulse: false, breathing: false, expression: false };

  private frameReceived = 0;
  private frameAccepted = 0;
  private frameRejected = 0;
  private frameTimes: number[] = [];
  private lastFrameAt: number | null = null;

  constructor(options: MetricsAdapterOptions) {
    this.mode = options.mode;
    this.expressionResponsiveness = options.expressionResponsiveness;
  }

  markSessionStart(nowMs: number): void {
    this.sessionStartMs = nowMs;
    this.roomStartMs = 0;
    this.coverageBins = [];
    this.ever = { pulse: false, breathing: false, expression: false };
  }

  markRoomStart(nowMs: number): void {
    if (this.roomStartMs === 0) this.roomStartMs = nowMs;
  }

  setExpressionResponsiveness(enabled: boolean): void {
    this.expressionResponsiveness = enabled;
  }

  setProcessing(processing: ProcessingState): void {
    this.processing = processing;
  }

  setValidation(validation: ValidationState): void {
    this.validation = validation;
  }

  /**
   * Decoded payload -> latest samples. Only samples newer than the last trace
   * timestamp are appended to the waveform window, so repeated payload history
   * cannot distort the normaliser.
   */
  handleMetrics(metrics: MetricsLike, nowMs: number): void {
    const pulse = readLatestMeasurement(metrics.cardio?.pulseRate, nowMs);
    if (pulse) this.pulse = pulse;

    const breathingRate = readLatestMeasurement(metrics.breathing?.rate, nowMs);
    if (breathingRate) this.breathingRate = breathingRate;

    const trace = metrics.breathing?.upperTrace ?? [];
    for (const sample of trace) {
      const value = finiteNumber(sample.value);
      const timestamp = timestampMicrosToMillis(sample.timestamp);
      if (value === null || !Number.isFinite(timestamp)) continue;
      if (timestamp <= this.lastWaveformTimestamp) continue;
      this.waveformWindow.add(value, timestamp);
      this.lastWaveformTimestamp = timestamp;
      this.waveform = {
        value,
        confidence: breathingRate?.confidence ?? 0,
        stable: sample.stable === true,
        timestamp,
        normalized: this.waveformWindow.position,
      };
    }

    // Re-price the latest waveform sample with the freshest breathing verdict.
    if (this.waveform && breathingRate) {
      this.waveform = {
        ...this.waveform,
        confidence: breathingRate.confidence,
        normalized: this.waveformWindow.position,
      };
    }

    const expression = readLatestExpression(metrics.face?.expression, nowMs);
    if (expression) this.expression = expression;
  }

  recordFrame(accepted: boolean, nowMs: number): void {
    this.frameReceived += 1;
    if (accepted) this.frameAccepted += 1;
    else this.frameRejected += 1;
    this.lastFrameAt = nowMs;
    this.frameTimes.push(nowMs);
    const cutoff = nowMs - 2_000;
    while (this.frameTimes.length > 0 && (this.frameTimes[0] ?? 0) < cutoff) {
      this.frameTimes.shift();
    }
  }

  private coverage(nowMs: number): {
    percent: number;
    stableSeconds: number;
    observedSeconds: number;
  } {
    if (this.sessionStartMs > 0) {
      const index = Math.floor((nowMs - this.sessionStartMs) / COVERAGE_BIN_MS);
      if (index >= 0 && index < MAX_COVERAGE_BINS) {
        while (this.coverageBins.length <= index) this.coverageBins.push(false);
      }
    }
    const stableSeconds = this.coverageBins.filter(Boolean).length;
    const observedSeconds = this.coverageBins.length;
    return {
      percent: observedSeconds > 0 ? Math.round((stableSeconds / observedSeconds) * 100) : 0,
      stableSeconds,
      observedSeconds,
    };
  }

  private markCoverage(nowMs: number, stable: boolean): void {
    if (this.sessionStartMs <= 0) return;
    const index = Math.floor((nowMs - this.sessionStartMs) / COVERAGE_BIN_MS);
    if (index < 0 || index >= MAX_COVERAGE_BINS) return;
    while (this.coverageBins.length <= index) this.coverageBins.push(false);
    if (stable) this.coverageBins[index] = true;
  }

  private frameStats(nowMs: number): FrameStats {
    const recent = this.frameTimes.filter((time) => nowMs - time <= 1_000).length;
    return {
      received: this.frameReceived,
      accepted: this.frameAccepted,
      rejected: this.frameRejected,
      fps: recent,
      lastFrameAt: this.lastFrameAt,
    };
  }

  buildSnapshot(nowMs: number): SignalSnapshot {
    const pulseOk = usablePulse(this.pulse, nowMs);
    const breathingOk = usableBreathing(this.breathingRate, nowMs);
    const expressionOk = expressionIsEligible(this.expression, nowMs);

    if (pulseOk) this.ever.pulse = true;
    if (breathingOk) this.ever.breathing = true;
    if (expressionOk) this.ever.expression = true;
    this.markCoverage(nowMs, pulseOk || breathingOk);

    const visual = mapSignalsToVisual({
      now: nowMs,
      pulse: this.pulse,
      breathingRate: this.breathingRate,
      waveform: this.waveform,
      expression: this.expression,
      expressionResponsiveness: this.expressionResponsiveness,
    });

    this.revision += 1;

    return {
      mode: this.mode,
      revision: this.revision,
      emittedAt: nowMs,
      sessionElapsedMs: this.sessionStartMs > 0 ? Math.max(0, nowMs - this.sessionStartMs) : 0,
      roomElapsedMs: this.roomStartMs > 0 ? Math.max(0, nowMs - this.roomStartMs) : 0,
      pulse: this.pulse,
      breathingRate: this.breathingRate,
      upperBreathingWaveform: this.waveform,
      expression: this.expression,
      validation: this.validation,
      processing: this.processing,
      visual,
      expressionResponsiveness: this.expressionResponsiveness,
      frameStats: this.frameStats(nowMs),
      stableCoverage: this.coverage(nowMs),
      signalsEverAvailable: { ...this.ever },
    };
  }

  getFacts(nowMs: number): SessionFacts {
    const durationMs = this.sessionStartMs > 0 ? Math.max(0, nowMs - this.sessionStartMs) : 0;
    const roomDurationMs = this.roomStartMs > 0 ? Math.max(0, nowMs - this.roomStartMs) : 0;
    const calibrationDurationMs =
      this.roomStartMs > 0 && this.sessionStartMs > 0
        ? Math.max(0, this.roomStartMs - this.sessionStartMs)
        : durationMs;
    return {
      mode: this.mode,
      durationMs,
      roomDurationMs,
      calibrationDurationMs,
      signalsAvailable: { ...this.ever },
      stableCoveragePercent: this.coverage(nowMs).percent,
      framesAccepted: this.frameAccepted,
      framesRejected: this.frameRejected,
    };
  }

  /** Clear camera-derived samples while keeping the scalar facts already returned. */
  clearSamples(): void {
    this.pulse = null;
    this.breathingRate = null;
    this.waveform = null;
    this.expression = null;
    this.validation = null;
    this.waveformWindow.reset();
    this.lastWaveformTimestamp = 0;
    this.coverageBins = [];
  }

  /** Full reset between sessions. */
  reset(): void {
    this.clearSamples();
    this.sessionStartMs = 0;
    this.roomStartMs = 0;
    this.revision = 0;
    this.ever = { pulse: false, breathing: false, expression: false };
    this.frameReceived = 0;
    this.frameAccepted = 0;
    this.frameRejected = 0;
    this.frameTimes = [];
    this.lastFrameAt = null;
    this.processing = { code: 0, label: 'Uninitialised' };
  }
}
