import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorScenario } from '../../src/shared/contracts';
import { SIMULATION_DISCLOSURE } from '../../src/simulator/scenarios';
import { SignalSimulator, type SimulatedMetrics } from '../../src/simulator/signal-simulator';

interface Harness {
  simulator: SignalSimulator;
  metrics: SimulatedMetrics[];
  validations: Array<{ code: number; timestampUs: number; hint: string }>;
}

function harness(scenario: SimulatorScenario): Harness {
  const metrics: SimulatedMetrics[] = [];
  const validations: Array<{ code: number; timestampUs: number; hint: string }> = [];
  const simulator = new SignalSimulator(
    scenario,
    {
      onMetrics: (value) => metrics.push(value),
      onValidation: (code, timestampUs, hint) => validations.push({ code, timestampUs, hint }),
    },
    { intervalMs: 200 },
  );
  return { simulator, metrics, validations };
}

const START = new Date('2026-11-09T12:00:00Z').getTime();

describe('SignalSimulator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits an immediate validation state and no metrics before warm-up', () => {
    const { simulator, metrics, validations } = harness('stable');
    simulator.start(START);
    expect(simulator.running).toBe(true);
    expect(metrics).toHaveLength(0);
    expect(validations[0]?.code).toBe(10);

    vi.advanceTimersByTime(1_000);
    expect(metrics).toHaveLength(0);

    vi.advanceTimersByTime(1_000);
    expect(metrics.length).toBeGreaterThan(0);

    const latest = metrics.at(-1);
    expect(latest?.cardio?.pulseRate[0]?.value).toBeGreaterThan(40);
    expect(latest?.breathing?.rate[0]?.value).toBeGreaterThan(5);
    simulator.dispose();
  });

  it('becomes stable with confidence above the official thresholds', () => {
    const { simulator, metrics } = harness('stable');
    simulator.start(START);
    vi.advanceTimersByTime(9_000);

    const latest = metrics.at(-1);
    const pulse = latest?.cardio?.pulseRate[0];
    const breathing = latest?.breathing?.rate[0];
    expect(pulse?.stable).toBe(true);
    expect(pulse?.confidence).toBeGreaterThanOrEqual(40);
    expect(breathing?.stable).toBe(true);
    expect(breathing?.confidence).toBeGreaterThanOrEqual(45);
    expect(latest?.breathing?.upperTrace).toHaveLength(1);
    expect(latest?.face?.expression[0]?.scores.length).toBe(4);
    simulator.dispose();
  });

  it('keeps the poor-lighting scenario below threshold with dark-scene guidance', () => {
    const { simulator, metrics, validations } = harness('poor_lighting');
    simulator.start(START);
    vi.advanceTimersByTime(10_000);

    expect(new Set(validations.map((value) => value.code))).toEqual(new Set([5]));
    for (const batch of metrics) {
      expect(batch.cardio?.pulseRate[0]?.stable).toBe(false);
      expect(batch.breathing?.rate[0]?.stable).toBe(false);
      expect(batch.face?.expression[0]?.stable).toBe(false);
    }
    simulator.dispose();
  });

  it('alternates motion guidance and stability', () => {
    const { simulator, validations, metrics } = harness('motion');
    simulator.start(START);
    vi.advanceTimersByTime(20_000);

    const codes = new Set(validations.map((value) => value.code));
    expect(codes.has(12)).toBe(true);
    expect(codes.has(0)).toBe(true);
    expect(metrics.some((batch) => batch.breathing?.rate[0]?.stable === false)).toBe(true);
    expect(metrics.some((batch) => batch.breathing?.rate[0]?.stable === true)).toBe(true);
    simulator.dispose();
  });

  it('produces breathing-only metrics for the partial scenario', () => {
    const { simulator, metrics } = harness('partial_signal');
    simulator.start(START);
    vi.advanceTimersByTime(9_000);

    const latest = metrics.at(-1);
    expect(latest?.breathing?.rate[0]?.stable).toBe(true);
    expect(latest?.breathing?.rate[0]?.confidence).toBeGreaterThanOrEqual(45);
    expect(latest?.cardio?.pulseRate[0]?.stable).toBe(false);
    expect(latest?.cardio?.pulseRate[0]?.confidence).toBeLessThan(40);
    simulator.dispose();
  });

  it('goes silent when the signal-loss scenario crosses its cutoff', () => {
    const { simulator, metrics, validations } = harness('signal_loss');
    simulator.start(START);
    vi.advanceTimersByTime(22_000);
    const before = metrics.length;
    expect(before).toBeGreaterThan(0);

    vi.advanceTimersByTime(3_000);
    expect(metrics.length).toBe(before);
    expect(validations.at(-1)?.code).toBe(1);
    simulator.dispose();
  });

  it('preserves elapsed calibration time when switching scenarios', () => {
    const { simulator, metrics } = harness('stable');
    simulator.start(START);
    vi.advanceTimersByTime(5_000);
    const before = metrics.length;

    simulator.setScenario('poor_lighting', START + 5_000);
    expect(simulator.currentScenario).toBe('poor_lighting');
    expect(metrics.length).toBeGreaterThan(before);
    expect(metrics.at(-1)?.breathing?.rate[0]?.stable).toBe(false);
    simulator.dispose();
  });

  it('stops idempotently and emits nothing afterwards', () => {
    const { simulator, metrics } = harness('stable');
    simulator.start(START);
    vi.advanceTimersByTime(3_000);
    simulator.stop();
    simulator.stop();
    expect(simulator.running).toBe(false);
    const count = metrics.length;
    vi.advanceTimersByTime(5_000);
    expect(metrics.length).toBe(count);
    simulator.dispose();
  });

  it('ships a permanent simulated-signal disclosure', () => {
    expect(SIMULATION_DISCLOSURE).toMatch(/^SIMULATED SIGNALS — NOT SMARTSPECTRA DATA\./);
    expect(SIMULATION_DISCLOSURE).toMatch(/generated locally/);
  });
});
