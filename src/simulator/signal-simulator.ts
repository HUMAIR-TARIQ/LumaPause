import type { SimulatorScenario } from '../shared/contracts';

export interface SimulatedMeasurement {
  value: number;
  stable: boolean;
  confidence: number;
  timestamp: number;
}

export interface SimulatedTrace {
  value: number;
  stable: boolean;
  timestamp: number;
}

export interface SimulatedMetrics {
  breathing?: {
    rate: SimulatedMeasurement[];
    upperTrace: SimulatedTrace[];
  };
  cardio?: {
    pulseRate: SimulatedMeasurement[];
  };
  face?: {
    expression: Array<{
      stable: boolean;
      timestamp: number;
      scores: Array<{ type: number; confidence: number }>;
    }>;
  };
}

export interface SimulatorCallbacks {
  onMetrics(metrics: SimulatedMetrics): void;
  onValidation(code: number, timestampUs: number, hint: string): void;
}

export interface SimulatorOptions {
  /** Interval between synthetic batches. Defaults to 200 ms (5 Hz). */
  intervalMs?: number;
}

const HINTS: Record<number, string> = {
  0: 'Face and upper chest are visible.',
  1: 'No face found in the frame.',
  5: 'The scene is too dark for a reliable measurement.',
  10: 'The camera is still tuning.',
  12: 'Excessive motion detected.',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ramp(elapsedSec: number, startSec: number, durationSec: number): number {
  if (elapsedSec < startSec) return 0;
  return clamp((elapsedSec - startSec) / durationSec, 0, 1);
}

function noise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

interface ScenarioFrame {
  validationCode: number;
  metrics: SimulatedMetrics | null;
}

/**
 * Local synthetic signal source implementing the same MetricsLike shape the
 * SmartSpectra adapter consumes. It never touches the SDK, the camera, or the
 * network. Every snapshot it produces is marked `mode: 'simulated'` by the
 * service and the UI shows a permanent disclosure banner.
 */
export class SignalSimulator {
  private scenario: SimulatorScenario;
  private readonly callbacks: SimulatorCallbacks;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scenarioStartedAt = 0;
  private scenarioElapsedBase = 0;
  private lastValidationAt = 0;
  private lastValidationCode = -1;

  constructor(
    scenario: SimulatorScenario,
    callbacks: SimulatorCallbacks,
    options: SimulatorOptions = {},
  ) {
    this.scenario = scenario;
    this.callbacks = callbacks;
    this.intervalMs = options.intervalMs ?? 200;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  get currentScenario(): SimulatorScenario {
    return this.scenario;
  }

  start(nowMs = Date.now()): void {
    if (this.timer) return;
    this.scenarioStartedAt = nowMs;
    this.scenarioElapsedBase = 0;
    this.lastValidationAt = 0;
    this.lastValidationCode = -1;
    this.tick(nowMs);
    this.timer = setInterval(() => this.tick(Date.now()), this.intervalMs);
  }

  setScenario(scenario: SimulatorScenario, nowMs = Date.now()): void {
    if (scenario === this.scenario) return;
    // Preserve elapsed time so switching a scenario mid-walkthrough does not
    // reset the calibration clock.
    this.scenarioElapsedBase += (nowMs - this.scenarioStartedAt) / 1_000;
    this.scenarioStartedAt = nowMs;
    this.scenario = scenario;
    this.lastValidationAt = 0;
    this.lastValidationCode = -1;
    this.tick(nowMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  /** Deterministic step used by tests and by the interval. */
  tick(nowMs = Date.now()): void {
    const elapsedSec = this.scenarioElapsedBase + (nowMs - this.scenarioStartedAt) / 1_000;
    const frame = this.frameFor(this.scenario, elapsedSec, nowMs);

    if (frame.metrics) {
      this.callbacks.onMetrics(frame.metrics);
    }

    const shouldEmitValidation =
      this.lastValidationAt === 0 ||
      nowMs - this.lastValidationAt >= 1_000 ||
      frame.validationCode !== this.lastValidationCode;
    if (shouldEmitValidation) {
      this.lastValidationAt = nowMs;
      this.lastValidationCode = frame.validationCode;
      this.callbacks.onValidation(
        frame.validationCode,
        nowMs * 1_000,
        HINTS[frame.validationCode] ?? '',
      );
    }
  }

  private frameFor(scenario: SimulatorScenario, elapsedSec: number, nowMs: number): ScenarioFrame {
    switch (scenario) {
      case 'stable':
        return {
          validationCode: elapsedSec < 1.5 ? 10 : 0,
          metrics: elapsedSec < 2 ? null : this.stableMetrics(elapsedSec, nowMs),
        };
      case 'poor_lighting':
        return {
          validationCode: 5,
          metrics: elapsedSec < 1 ? null : this.lowConfidenceMetrics(elapsedSec, nowMs),
        };
      case 'motion': {
        const moving = Math.sin(elapsedSec / 2.2) > -0.2;
        return {
          validationCode: moving ? 12 : 0,
          metrics: elapsedSec < 1 ? null : this.motionMetrics(elapsedSec, nowMs, moving),
        };
      }
      case 'partial_signal':
        return {
          validationCode: elapsedSec < 1 ? 10 : 0,
          metrics: elapsedSec < 2 ? null : this.partialMetrics(elapsedSec, nowMs),
        };
      case 'signal_loss':
        if (elapsedSec > 22) {
          return { validationCode: 1, metrics: null };
        }
        return {
          validationCode: elapsedSec < 1.5 ? 10 : 0,
          metrics: elapsedSec < 2 ? null : this.stableMetrics(elapsedSec, nowMs),
        };
      default:
        return { validationCode: 10, metrics: null };
    }
  }

  private expressionScores(
    stable: boolean,
    dominant: 'HAPPY' | 'NEUTRAL' | 'MIXED',
    timestampUs: number,
    nowMs: number,
  ): SimulatedMetrics['face'] {
    const wobble = Math.sin(nowMs / 1_400) * 2;
    const scores =
      dominant === 'HAPPY'
        ? [
            { type: 5, confidence: 58 + wobble },
            { type: 6, confidence: 30 - wobble / 2 },
            { type: 8, confidence: 7 },
            { type: 7, confidence: 3 },
          ]
        : dominant === 'NEUTRAL'
          ? [
              { type: 6, confidence: 64 + wobble },
              { type: 5, confidence: 22 - wobble / 2 },
              { type: 8, confidence: 8 },
              { type: 7, confidence: 3 },
            ]
          : [
              { type: 5, confidence: 45 },
              { type: 6, confidence: 42 },
              { type: 8, confidence: 8 },
              { type: 7, confidence: 4 },
            ];
    return {
      expression: [
        {
          stable,
          timestamp: timestampUs,
          scores: scores.map((score) => ({
            type: score.type,
            confidence: Math.round(score.confidence * 10) / 10,
          })),
        },
      ],
    };
  }

  private baseMetrics(
    elapsedSec: number,
    nowMs: number,
    options: {
      breathingConfidence: number;
      pulseConfidence: number;
      breathingStable: boolean;
      pulseStable: boolean;
      expressionStable: boolean;
      expressionDominant: 'HAPPY' | 'NEUTRAL' | 'MIXED';
    },
  ): SimulatedMetrics {
    const timestampUs = nowMs * 1_000;
    const periodSec = 4.5 + Math.sin(elapsedSec / 9) * 0.35;
    const breathingRate = 60 / periodSec;
    const chest = Math.sin((elapsedSec / periodSec) * Math.PI * 2) * 10;
    const drift = Math.sin(elapsedSec / 7) * 1.8;
    const jitter = (noise(nowMs / 200) - 0.5) * 1.4;
    const pulse = 68 + Math.sin(elapsedSec / 6) * 2.4 + jitter;

    return {
      breathing: {
        rate: [
          {
            value: Math.round((breathingRate + jitter * 0.1) * 10) / 10,
            stable: options.breathingStable,
            confidence: Math.round(options.breathingConfidence),
            timestamp: timestampUs,
          },
        ],
        upperTrace: [
          {
            value: Math.round((chest + drift) * 100) / 100,
            stable: options.breathingStable,
            timestamp: timestampUs,
          },
        ],
      },
      cardio: {
        pulseRate: [
          {
            value: Math.round(pulse * 10) / 10,
            stable: options.pulseStable,
            confidence: Math.round(options.pulseConfidence),
            timestamp: timestampUs,
          },
        ],
      },
      face: this.expressionScores(
        options.expressionStable,
        options.expressionDominant,
        timestampUs,
        nowMs,
      ),
    };
  }

  private stableMetrics(elapsedSec: number, nowMs: number): SimulatedMetrics {
    const breathingConfidence = 30 + ramp(elapsedSec, 3, 5) * 48;
    const pulseConfidence = 25 + ramp(elapsedSec, 2, 4) * 50;
    return this.baseMetrics(elapsedSec, nowMs, {
      breathingConfidence,
      pulseConfidence,
      breathingStable: breathingConfidence >= 45,
      pulseStable: pulseConfidence >= 40,
      expressionStable: true,
      expressionDominant: 'HAPPY',
    });
  }

  private lowConfidenceMetrics(elapsedSec: number, nowMs: number): SimulatedMetrics {
    return this.baseMetrics(elapsedSec, nowMs, {
      breathingConfidence: 18 + ramp(elapsedSec, 2, 6) * 14,
      pulseConfidence: 14 + ramp(elapsedSec, 2, 6) * 16,
      breathingStable: false,
      pulseStable: false,
      expressionStable: false,
      expressionDominant: 'NEUTRAL',
    });
  }

  private motionMetrics(elapsedSec: number, nowMs: number, moving: boolean): SimulatedMetrics {
    const sway = Math.sin(elapsedSec * 2.4) * 9;
    const breathingConfidence = 40 + sway;
    const pulseConfidence = 34 + sway * 0.9;
    return this.baseMetrics(elapsedSec, nowMs, {
      breathingConfidence,
      pulseConfidence,
      breathingStable: !moving && breathingConfidence >= 45,
      pulseStable: !moving && pulseConfidence >= 40,
      expressionStable: !moving,
      expressionDominant: moving ? 'MIXED' : 'HAPPY',
    });
  }

  private partialMetrics(elapsedSec: number, nowMs: number): SimulatedMetrics {
    const breathingConfidence = 32 + ramp(elapsedSec, 3, 5) * 46;
    return this.baseMetrics(elapsedSec, nowMs, {
      breathingConfidence,
      pulseConfidence: 24 + ramp(elapsedSec, 2, 6) * 10,
      breathingStable: breathingConfidence >= 45,
      pulseStable: false,
      expressionStable: true,
      expressionDominant: 'NEUTRAL',
    });
  }
}
