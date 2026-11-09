import { describe, expect, it } from 'vitest';
import { MAX_WAVEFORM_SAMPLES, SAMPLE_STALE_MS } from '../../src/shared/constants';
import {
  MetricsAdapter,
  WaveformWindow,
  processingFromCode,
  readLatestExpression,
  readLatestMeasurement,
  timestampMicrosToMillis,
  type MetricsLike,
} from '../../src/main/smartspectra/metrics-adapter';

const NOW = 1_760_000_000_000;

function micros(ms: number): number {
  return ms * 1_000;
}

function measurement(value: number, overrides: Record<string, unknown> = {}) {
  return {
    value,
    confidence: 70,
    stable: true,
    timestamp: micros(NOW),
    ...overrides,
  };
}

function stableMetrics(now: number, values = { pulse: 64, breathing: 12 }): MetricsLike {
  return {
    cardio: { pulseRate: [measurement(values.pulse)] },
    breathing: {
      rate: [measurement(values.breathing)],
      upperTrace: [
        measurement(1, { confidence: undefined }),
        measurement(2, { confidence: undefined }),
      ],
    },
    face: {
      expression: [
        {
          stable: true,
          timestamp: micros(now),
          scores: [
            { type: 5, confidence: 62 },
            { type: 6, confidence: 30 },
          ],
        },
      ],
    },
  };
}

describe('SmartSpectra timestamp and payload decoding', () => {
  it('converts microsecond epoch values from numbers, bigint and Long-like objects', () => {
    expect(timestampMicrosToMillis(micros(NOW))).toBe(NOW);
    expect(timestampMicrosToMillis(BigInt(micros(NOW)))).toBe(NOW);
    expect(timestampMicrosToMillis({ toNumber: () => micros(NOW) })).toBe(NOW);
    const microsValue = micros(NOW);
    const high = Math.floor(microsValue / 4_294_967_296);
    const low = microsValue - high * 4_294_967_296;
    expect(timestampMicrosToMillis({ high, low })).toBe(NOW);
  });

  it('rejects unusable timestamps without inventing values', () => {
    expect(timestampMicrosToMillis(0)).toBeNaN();
    expect(timestampMicrosToMillis(-5)).toBeNaN();
    expect(timestampMicrosToMillis('123')).toBeNaN();
    expect(timestampMicrosToMillis(undefined)).toBeNaN();
    expect(timestampMicrosToMillis(Number.NaN)).toBeNaN();
  });

  it('reads the latest measurement and normalises confidence', () => {
    const parsed = readLatestMeasurement(
      [measurement(60, { confidence: 10 }), measurement(72, { confidence: 140 })],
      NOW,
    );
    expect(parsed).toEqual({
      value: 72,
      confidence: 100,
      stable: true,
      timestamp: NOW,
    });

    expect(readLatestMeasurement([], NOW)).toBeNull();
    expect(readLatestMeasurement(null, NOW)).toBeNull();
    expect(readLatestMeasurement([measurement(Number.NaN)], NOW)).toBeNull();
    expect(
      readLatestMeasurement([measurement(70, { stable: 'yes', confidence: 'x' })], NOW),
    ).toMatchObject({ confidence: 0, stable: false });
  });

  it('falls back to the adapter clock when a timestamp is missing', () => {
    const parsed = readLatestMeasurement([measurement(70, { timestamp: undefined })], NOW);
    expect(parsed?.timestamp).toBe(NOW);
  });

  it('builds expression probabilities, ignoring unknown fields and clamping scores', () => {
    const expression = readLatestExpression(
      [
        {
          stable: true,
          timestamp: micros(NOW),
          scores: [
            { type: 5, confidence: 62.4 },
            { type: 5, confidence: 60 },
            { type: 6, confidence: 120 },
            { type: 99, confidence: 50 },
            { type: 'bad', confidence: 10 },
            { type: 7, confidence: Number.NaN },
          ],
        },
      ],
      NOW,
    );
    expect(expression?.probabilities).toEqual({
      HAPPY: 62.4,
      NEUTRAL: 100,
      UNSPECIFIED: 50,
    });
    expect(expression?.dominant).toBe('NEUTRAL');
    expect(expression?.dominantConfidence).toBe(100);
    expect(expression?.stable).toBe(true);
    expect(expression?.timestamp).toBe(NOW);
  });

  it('returns no expression when the payload has no scores', () => {
    expect(
      readLatestExpression([{ stable: true, timestamp: micros(NOW), scores: [] }], NOW),
    ).toMatchObject({ dominant: null, dominantConfidence: 0, probabilities: {} });
    expect(readLatestExpression([], NOW)).toBeNull();
    expect(readLatestExpression(undefined, NOW)).toBeNull();
  });

  it('maps processing codes with a safe fallback label', () => {
    expect(processingFromCode(3).label).toBe('Running');
    expect(processingFromCode(5).label).toBe('Error');
    expect(processingFromCode(99).label).toBe('Uninitialised');
  });
});

describe('WaveformWindow', () => {
  it('normalises position within a rolling window and smooths changes', () => {
    const window = new WaveformWindow();
    window.add(0, NOW - 2_000);
    window.add(10, NOW - 1_000);
    expect(window.size).toBe(2);
    expect(window.position).toBeCloseTo(0.625);

    window.add(0, NOW);
    expect(window.position).toBeCloseTo(0.46875);

    window.reset();
    expect(window.position).toBe(0.5);
    expect(window.size).toBe(0);
  });

  it('returns a neutral position for a flat signal or a single sample', () => {
    const window = new WaveformWindow();
    window.add(5, NOW);
    expect(window.position).toBe(0.5);
    window.add(5, NOW + 100);
    expect(window.position).toBe(0.5);
  });

  it('drops samples outside the ten-second window and caps history', () => {
    const window = new WaveformWindow();
    window.add(1, NOW);
    window.add(2, NOW + 11_000);
    expect(window.size).toBe(1);
    expect(window.position).toBe(0.5);

    const capped = new WaveformWindow();
    for (let index = 0; index < MAX_WAVEFORM_SAMPLES + 100; index += 1) {
      capped.add(index, NOW + index);
    }
    expect(capped.size).toBe(MAX_WAVEFORM_SAMPLES);
  });

  it('ignores non-finite input without throwing', () => {
    const window = new WaveformWindow();
    window.add(Number.NaN, NOW);
    window.add(1, Number.NaN);
    expect(window.size).toBe(0);
    expect(window.position).toBe(0.5);
  });
});

describe('MetricsAdapter', () => {
  it('turns fresh stable metrics into measured visuals', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: true });
    adapter.markSessionStart(NOW);
    adapter.handleMetrics(stableMetrics(NOW), NOW);
    const snapshot = adapter.buildSnapshot(NOW + 100);

    expect(snapshot.mode).toBe('live');
    expect(snapshot.revision).toBe(1);
    expect(snapshot.sessionElapsedMs).toBe(100);
    expect(snapshot.visual.signalAvailability).toBe('ready');
    expect(snapshot.visual.measuredPulse).toBe(true);
    expect(snapshot.visual.measuredBreathing).toBe(true);
    expect(snapshot.signalsEverAvailable).toEqual({
      pulse: true,
      breathing: true,
      expression: true,
    });
    expect(snapshot.pulse?.value).toBe(64);
    expect(snapshot.breathingRate?.value).toBe(12);
  });

  it('reports stale samples as unavailable and never carries them forward', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: true });
    adapter.markSessionStart(NOW);
    adapter.handleMetrics(stableMetrics(NOW), NOW);

    const fresh = adapter.buildSnapshot(NOW + 100);
    expect(fresh.visual.measuredPulse).toBe(true);

    const stale = adapter.buildSnapshot(NOW + SAMPLE_STALE_MS + 1);
    expect(stale.visual.measuredPulse).toBe(false);
    expect(stale.visual.measuredBreathing).toBe(false);
    expect(stale.visual.signalAvailability).toBe('none');
    expect(stale.pulse?.value).toBe(64);
    expect(stale.signalsEverAvailable.pulse).toBe(true);
  });

  it('ignores repeated trace history from the SDK payload', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: false });
    adapter.markSessionStart(NOW);
    const metric = stableMetrics(NOW);
    adapter.handleMetrics(metric, NOW);
    adapter.handleMetrics(metric, NOW);
    const snapshot = adapter.buildSnapshot(NOW + 100);
    expect(snapshot.upperBreathingWaveform?.normalized).toBeDefined();
    expect(snapshot.frameStats.received).toBe(0);
  });

  it('respects the expression responsiveness switch', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: true });
    adapter.markSessionStart(NOW);
    adapter.handleMetrics(stableMetrics(NOW), NOW);
    const warm = adapter.buildSnapshot(NOW + 100).visual.paletteWarmth;
    expect(warm).toBeGreaterThan(0.45);

    adapter.setExpressionResponsiveness(false);
    const neutral = adapter.buildSnapshot(NOW + 200).visual.paletteWarmth;
    expect(neutral).toBe(0.45);
  });

  it('tracks accepted and rejected frames with a rolling frame rate', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: false });
    adapter.markSessionStart(NOW);
    adapter.recordFrame(true, NOW);
    adapter.recordFrame(false, NOW + 100);
    adapter.recordFrame(true, NOW + 200);
    const snapshot = adapter.buildSnapshot(NOW + 250);
    expect(snapshot.frameStats).toMatchObject({
      received: 3,
      accepted: 2,
      rejected: 1,
      fps: 3,
      lastFrameAt: NOW + 200,
    });

    const later = adapter.buildSnapshot(NOW + 2_000);
    expect(later.frameStats.fps).toBe(0);
  });

  it('reports bounded stable coverage and scalar session facts', () => {
    const adapter = new MetricsAdapter({ mode: 'live', expressionResponsiveness: false });
    adapter.markSessionStart(NOW);
    adapter.handleMetrics(stableMetrics(NOW), NOW);
    adapter.markRoomStart(NOW + 1_000);
    const snapshot = adapter.buildSnapshot(NOW + 2_500);

    expect(snapshot.stableCoverage.stableSeconds).toBe(1);
    expect(snapshot.stableCoverage.observedSeconds).toBe(3);
    expect(snapshot.stableCoverage.percent).toBe(33);
    expect(snapshot.roomElapsedMs).toBe(1_500);
    expect(snapshot.sessionElapsedMs).toBe(2_500);

    const facts = adapter.getFacts(NOW + 2_500);
    expect(facts).toMatchObject({
      mode: 'live',
      durationMs: 2_500,
      roomDurationMs: 1_500,
      calibrationDurationMs: 1_000,
      stableCoveragePercent: 33,
    });
  });

  it('clears samples while keeping scalar facts, and reset removes everything', () => {
    const adapter = new MetricsAdapter({ mode: 'simulated', expressionResponsiveness: true });
    adapter.markSessionStart(NOW);
    adapter.handleMetrics(stableMetrics(NOW), NOW);
    adapter.buildSnapshot(NOW + 100);
    adapter.clearSamples();

    const cleared = adapter.buildSnapshot(NOW + 200);
    expect(cleared.pulse).toBeNull();
    expect(cleared.breathingRate).toBeNull();
    expect(cleared.expression).toBeNull();
    expect(cleared.upperBreathingWaveform).toBeNull();
    expect(cleared.visual.signalAvailability).toBe('none');

    adapter.reset();
    const reset = adapter.buildSnapshot(NOW + 300);
    expect(reset.revision).toBe(1);
    expect(reset.sessionElapsedMs).toBe(0);
    expect(reset.signalsEverAvailable).toEqual({
      pulse: false,
      breathing: false,
      expression: false,
    });
    expect(reset.processing.label).toBe('Uninitialised');
  });
});
