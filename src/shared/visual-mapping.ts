import {
  BREATHING_CONFIDENCE_THRESHOLD,
  BREATHING_PERIOD_MAX_MS,
  BREATHING_PERIOD_MIN_MS,
  BREATHING_SANITY_MAX,
  BREATHING_SANITY_MIN,
  BREATH_SCALE_MAX,
  BREATH_SCALE_MIN,
  EXPRESSION_CONFIDENCE_THRESHOLD,
  EXPRESSION_WEIGHTS,
  PULSE_CONFIDENCE_THRESHOLD,
  PULSE_GLOW_MAX,
  PULSE_GLOW_MIN,
  PULSE_SANITY_MAX,
  PULSE_SANITY_MIN,
  SAMPLE_STALE_MS,
} from './constants';
import type { ExpressionState, SignalAvailability, SignalSample, VisualState } from './contracts';

export interface VisualMappingInput {
  now: number;
  pulse: SignalSample | null;
  breathingRate: SignalSample | null;
  waveform: SignalSample | null;
  expression: ExpressionState | null;
  expressionResponsiveness: boolean;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(value: number): number {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function timestampIsFresh(timestamp: number, now: number): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const age = now - timestamp;
  // Tolerate small clock skew but reject timestamps from the future or from long ago.
  return age <= SAMPLE_STALE_MS && age >= -1_000;
}

export function isUsableSample(
  sample: SignalSample | null | undefined,
  now: number,
  confidenceThreshold: number,
  sanityMin: number,
  sanityMax: number,
): sample is SignalSample {
  if (!sample) return false;
  if (!Number.isFinite(sample.value)) return false;
  if (sample.value < sanityMin || sample.value > sanityMax) return false;
  if (!Number.isFinite(sample.confidence)) return false;
  if (sample.confidence < confidenceThreshold) return false;
  if (sample.stable !== true) return false;
  if (!timestampIsFresh(sample.timestamp, now)) return false;
  return true;
}

export function usablePulse(sample: SignalSample | null, now: number): boolean {
  return isUsableSample(
    sample,
    now,
    PULSE_CONFIDENCE_THRESHOLD,
    PULSE_SANITY_MIN,
    PULSE_SANITY_MAX,
  );
}

export function usableBreathing(sample: SignalSample | null, now: number): boolean {
  return isUsableSample(
    sample,
    now,
    BREATHING_CONFIDENCE_THRESHOLD,
    BREATHING_SANITY_MIN,
    BREATHING_SANITY_MAX,
  );
}

export function usableWaveform(sample: SignalSample | null, now: number): boolean {
  if (!sample) return false;
  if (!Number.isFinite(sample.value)) return false;
  if (sample.stable !== true) return false;
  if (!Number.isFinite(sample.confidence)) return false;
  if (sample.confidence < BREATHING_CONFIDENCE_THRESHOLD) return false;
  return timestampIsFresh(sample.timestamp, now);
}

export function expressionIsEligible(
  expression: ExpressionState | null,
  now: number,
): expression is ExpressionState {
  if (!expression) return false;
  if (!expression.stable) return false;
  if (!Number.isFinite(expression.dominantConfidence)) return false;
  if (expression.dominantConfidence < EXPRESSION_CONFIDENCE_THRESHOLD) return false;
  if (!expression.dominant) return false;
  if (!timestampIsFresh(expression.timestamp, now)) return false;
  const scores = Object.values(expression.probabilities);
  return scores.length > 0 && scores.every((score) => Number.isFinite(score));
}

export function deriveAvailability(
  pulseUsable: boolean,
  breathingUsable: boolean,
): SignalAvailability {
  if (pulseUsable && breathingUsable) return 'ready';
  if (pulseUsable || breathingUsable) return 'partial';
  return 'none';
}

/**
 * Compute a gentle palette warmth from the dominant expression only.
 * This never produces a categorical claim and can be disabled by the user.
 */
export function expressionWarmth(
  expression: ExpressionState | null,
  enabled: boolean,
  now: number,
): number {
  if (!enabled || !expressionIsEligible(expression, now)) return 0.45;
  const weight = EXPRESSION_WEIGHTS[expression.dominant ?? 'UNSPECIFIED'] ?? 0;
  const strength = expression.dominantConfidence / 100;
  return clamp(0.48 + weight * 0.3 * strength, 0.18, 0.88);
}

/**
 * Pure signal-to-visual mapping. The renderer interpolates toward these targets;
 * this function only validates, clamps and derives bounded parameters.
 */
export function mapSignalsToVisual(input: VisualMappingInput): VisualState {
  const { now } = input;
  const pulseOk = usablePulse(input.pulse, now);
  const breathingOk = usableBreathing(input.breathingRate, now);
  const waveformOk = usableWaveform(input.waveform, now);

  const availability = deriveAvailability(pulseOk, breathingOk);

  const measuredBreathing = waveformOk && input.waveform?.normalized !== undefined;
  const breathPosition = measuredBreathing ? smoothstep(input.waveform?.normalized ?? 0.5) : 0;

  const breathScale = measuredBreathing
    ? clamp(
        BREATH_SCALE_MIN + (BREATH_SCALE_MAX - BREATH_SCALE_MIN) * breathPosition,
        BREATH_SCALE_MIN,
        BREATH_SCALE_MAX,
      )
    : 1;

  const pulseGlow = pulseOk
    ? clamp(PULSE_GLOW_MIN + 0.68 * (input.pulse!.confidence / 100), PULSE_GLOW_MIN, PULSE_GLOW_MAX)
    : 0.16;

  const particleVelocity = breathingOk
    ? clamp(0.2 + 0.8 * (input.breathingRate!.confidence / 100), 0, 1)
    : 0.12;

  const breathingPeriodMs =
    breathingOk && input.breathingRate
      ? clamp(60_000 / input.breathingRate.value, BREATHING_PERIOD_MIN_MS, BREATHING_PERIOD_MAX_MS)
      : null;

  return {
    breathScale,
    pulseGlow,
    particleVelocity,
    paletteWarmth: expressionWarmth(input.expression, input.expressionResponsiveness, now),
    breathingPeriodMs,
    measuredBreathing: Boolean(measuredBreathing),
    measuredPulse: pulseOk,
    signalAvailability: availability,
  };
}

export const AMBIENT_VISUAL: VisualState = {
  breathScale: 1,
  pulseGlow: 0.16,
  particleVelocity: 0.12,
  paletteWarmth: 0.45,
  breathingPeriodMs: null,
  measuredBreathing: false,
  measuredPulse: false,
  signalAvailability: 'none',
};
