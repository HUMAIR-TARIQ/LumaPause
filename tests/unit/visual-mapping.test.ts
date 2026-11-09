import { describe, expect, it } from 'vitest';
import {
  BREATHING_CONFIDENCE_THRESHOLD,
  BREATHING_PERIOD_MAX_MS,
  BREATHING_PERIOD_MIN_MS,
  BREATH_SCALE_MAX,
  BREATH_SCALE_MIN,
  PULSE_CONFIDENCE_THRESHOLD,
  PULSE_GLOW_MAX,
  PULSE_GLOW_MIN,
  SAMPLE_STALE_MS,
} from '../../src/shared/constants';
import type { ExpressionState, SignalSample } from '../../src/shared/contracts';
import {
  AMBIENT_VISUAL,
  clamp,
  deriveAvailability,
  expressionIsEligible,
  expressionWarmth,
  isUsableSample,
  mapSignalsToVisual,
  smoothstep,
  usableBreathing,
  usablePulse,
  usableWaveform,
} from '../../src/shared/visual-mapping';

const NOW = 1_760_000_000_000;

function sample(overrides: Partial<SignalSample> = {}): SignalSample {
  return {
    value: 64,
    confidence: 70,
    stable: true,
    timestamp: NOW,
    ...overrides,
  };
}

function expression(overrides: Partial<ExpressionState> = {}): ExpressionState {
  return {
    probabilities: { HAPPY: 62, NEUTRAL: 30, SAD: 8 },
    dominant: 'HAPPY',
    dominantConfidence: 62,
    stable: true,
    timestamp: NOW,
    ...overrides,
  };
}

describe('visual mapping core', () => {
  it('clamps values and smooths an unbounded input into 0..1', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 2, 4)).toBe(2);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
  });

  it('accepts a sample only when it is finite, in range, confident, stable and fresh', () => {
    expect(isUsableSample(sample(), NOW, PULSE_CONFIDENCE_THRESHOLD, 20, 260)).toBe(true);
    expect(isUsableSample(null, NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ value: Number.NaN }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ value: 19.9 }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ value: 261 }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ confidence: Number.NaN }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ confidence: 39.9 }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ stable: false }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ timestamp: NOW - SAMPLE_STALE_MS - 1 }), NOW, 40, 20, 260)).toBe(
      false,
    );
    expect(isUsableSample(sample({ timestamp: NOW - SAMPLE_STALE_MS }), NOW, 40, 20, 260)).toBe(
      true,
    );
    expect(isUsableSample(sample({ timestamp: NOW + 1_001 }), NOW, 40, 20, 260)).toBe(false);
    expect(isUsableSample(sample({ timestamp: 0 }), NOW, 40, 20, 260)).toBe(false);
  });

  it('uses the documented breathing and pulse thresholds', () => {
    expect(usablePulse(sample({ confidence: PULSE_CONFIDENCE_THRESHOLD }), NOW)).toBe(true);
    expect(usablePulse(sample({ confidence: PULSE_CONFIDENCE_THRESHOLD - 1 }), NOW)).toBe(false);
    expect(usableBreathing(sample({ confidence: BREATHING_CONFIDENCE_THRESHOLD }), NOW)).toBe(true);
    expect(usableBreathing(sample({ confidence: BREATHING_CONFIDENCE_THRESHOLD - 1 }), NOW)).toBe(
      false,
    );
    expect(usablePulse(sample({ value: 300 }), NOW)).toBe(false);
    expect(usableBreathing(sample({ value: 100 }), NOW)).toBe(false);
  });

  it('judges the waveform by confidence and freshness, not its unitless value', () => {
    expect(usableWaveform(sample({ value: -100 }), NOW)).toBe(true);
    expect(usableWaveform(sample({ confidence: 44.9 }), NOW)).toBe(false);
    expect(usableWaveform(sample({ timestamp: NOW - 6_000 }), NOW)).toBe(false);
  });

  it('derives availability from independent signal verdicts', () => {
    expect(deriveAvailability(true, true)).toBe('ready');
    expect(deriveAvailability(true, false)).toBe('partial');
    expect(deriveAvailability(false, true)).toBe('partial');
    expect(deriveAvailability(false, false)).toBe('none');
  });
});

describe('expression gating', () => {
  it('requires stability, confidence, a dominant label, fresh time and finite scores', () => {
    expect(expressionIsEligible(expression(), NOW)).toBe(true);
    expect(expressionIsEligible(null, NOW)).toBe(false);
    expect(expressionIsEligible(expression({ stable: false }), NOW)).toBe(false);
    expect(expressionIsEligible(expression({ dominant: null }), NOW)).toBe(false);
    expect(expressionIsEligible(expression({ dominantConfidence: 54.9 }), NOW)).toBe(false);
    expect(expressionIsEligible(expression({ timestamp: NOW - 6_000 }), NOW)).toBe(false);
    expect(expressionIsEligible(expression({ probabilities: { HAPPY: Number.NaN } }), NOW)).toBe(
      false,
    );
    expect(expressionIsEligible(expression({ probabilities: {} }), NOW)).toBe(false);
  });

  it('returns a neutral warmth when disabled, ineligible or unknown', () => {
    expect(expressionWarmth(expression(), false, NOW)).toBe(0.45);
    expect(expressionWarmth(null, true, NOW)).toBe(0.45);
    expect(expressionWarmth(expression({ stable: false }), true, NOW)).toBe(0.45);
    expect(
      expressionWarmth(
        expression({ dominant: 'UNRECOGNISED', probabilities: { UNRECOGNISED: 90 } }),
        true,
        NOW,
      ),
    ).toBeCloseTo(0.48);
  });

  it('bends palette warmth gently and keeps it bounded', () => {
    const happy = expressionWarmth(expression(), true, NOW);
    const sad = expressionWarmth(
      expression({ dominant: 'SAD', probabilities: { SAD: 100 }, dominantConfidence: 100 }),
      true,
      NOW,
    );
    expect(happy).toBeGreaterThan(0.45);
    expect(sad).toBeLessThan(0.45);
    expect(happy).toBeLessThanOrEqual(0.88);
    expect(sad).toBeGreaterThanOrEqual(0.18);
  });
});

describe('mapSignalsToVisual', () => {
  const waveform = sample({ value: 2, confidence: 80, normalized: 1 });

  it('produces the ambient baseline without fresh signals', () => {
    const visual = mapSignalsToVisual({
      now: NOW,
      pulse: null,
      breathingRate: null,
      waveform: null,
      expression: null,
      expressionResponsiveness: false,
    });
    expect(visual).toEqual(AMBIENT_VISUAL);
    expect(visual.signalAvailability).toBe('none');
    expect(visual.measuredBreathing).toBe(false);
    expect(visual.measuredPulse).toBe(false);
  });

  it('maps stable pulse and breathing into bounded visual parameters', () => {
    const visual = mapSignalsToVisual({
      now: NOW,
      pulse: sample({ confidence: 60 }),
      breathingRate: sample({ value: 12, confidence: 60 }),
      waveform,
      expression: null,
      expressionResponsiveness: false,
    });
    expect(visual.measuredPulse).toBe(true);
    expect(visual.measuredBreathing).toBe(true);
    expect(visual.signalAvailability).toBe('ready');
    expect(visual.breathScale).toBeCloseTo(BREATH_SCALE_MAX);
    expect(visual.pulseGlow).toBeCloseTo(PULSE_GLOW_MIN + 0.68 * 0.6);
    expect(visual.breathingPeriodMs).toBe(5_000);
    expect(visual.particleVelocity).toBeCloseTo(0.68);
  });

  it('clamps breathing period and orb scale at the extremes', () => {
    const fast = mapSignalsToVisual({
      now: NOW,
      pulse: null,
      breathingRate: sample({ value: 60, confidence: 80 }),
      waveform: sample({ normalized: 0 }),
      expression: null,
      expressionResponsiveness: false,
    });
    expect(fast.breathingPeriodMs).toBe(BREATHING_PERIOD_MIN_MS);
    expect(fast.breathScale).toBeCloseTo(BREATH_SCALE_MIN);

    const slow = mapSignalsToVisual({
      now: NOW,
      pulse: null,
      breathingRate: sample({ value: 4, confidence: 80 }),
      waveform: sample({ normalized: 0.5 }),
      expression: null,
      expressionResponsiveness: false,
    });
    expect(slow.breathingPeriodMs).toBe(BREATHING_PERIOD_MAX_MS);
    expect(slow.breathScale).toBeCloseTo(1);
  });

  it('never presents stale or low-confidence samples as a reading', () => {
    const visual = mapSignalsToVisual({
      now: NOW,
      pulse: sample({ timestamp: NOW - 6_000 }),
      breathingRate: sample({ confidence: 44 }),
      waveform: sample({ timestamp: NOW - 6_000, normalized: 1 }),
      expression: expression({ timestamp: NOW - 6_000 }),
      expressionResponsiveness: true,
    });
    expect(visual.measuredPulse).toBe(false);
    expect(visual.measuredBreathing).toBe(false);
    expect(visual.signalAvailability).toBe('none');
    expect(visual.breathScale).toBe(1);
    expect(visual.breathingPeriodMs).toBeNull();
    expect(visual.paletteWarmth).toBe(0.45);
  });

  it('marks a single available signal as partial', () => {
    const visual = mapSignalsToVisual({
      now: NOW,
      pulse: sample(),
      breathingRate: sample({ confidence: 10 }),
      waveform: null,
      expression: null,
      expressionResponsiveness: false,
    });
    expect(visual.signalAvailability).toBe('partial');
    expect(visual.measuredPulse).toBe(true);
    expect(visual.measuredBreathing).toBe(false);
    expect(visual.particleVelocity).toBe(0.12);
  });

  it('keeps pulse glow inside its documented bound', () => {
    const visual = mapSignalsToVisual({
      now: NOW,
      pulse: sample({ confidence: 100 }),
      breathingRate: null,
      waveform: null,
      expression: null,
      expressionResponsiveness: false,
    });
    expect(visual.pulseGlow).toBeLessThanOrEqual(PULSE_GLOW_MAX);
    expect(visual.pulseGlow).toBeGreaterThanOrEqual(PULSE_GLOW_MIN);
  });
});
