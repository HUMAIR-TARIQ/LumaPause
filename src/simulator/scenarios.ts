import type { SimulatorScenario } from '../shared/contracts';

export interface ScenarioProfile {
  id: SimulatorScenario;
  label: string;
  description: string;
  /** What the walkthrough should demonstrate. Shown in the demo setup screen. */
  demonstrates: string;
}

export const SCENARIOS: Record<SimulatorScenario, ScenarioProfile> = {
  stable: {
    id: 'stable',
    label: 'Stable signals',
    description:
      'Breathing and pulse become stable after a short warm-up, then the orb, glow and palette respond to the simulated samples.',
    demonstrates: 'A complete live-shaped journey: calibration, responsive room, reflection.',
  },
  poor_lighting: {
    id: 'poor_lighting',
    label: 'Poor lighting',
    description:
      'The SDK validation code stays at “too dark” and confidence never reaches the official stable thresholds.',
    demonstrates: 'Honest guidance, “still learning” language, and an ambient-only room.',
  },
  motion: {
    id: 'motion',
    label: 'Movement',
    description:
      'Movement interrupts stability. Signals flicker between learning and available while guidance asks for stillness.',
    demonstrates: 'Graceful degradation, staleness handling, and non-judgemental guidance.',
  },
  partial_signal: {
    id: 'partial_signal',
    label: 'Breathing only',
    description:
      'Breathing becomes stable while pulse stays below the official confidence threshold.',
    demonstrates: 'The partial-signal screen and a room shaped by breathing alone.',
  },
  signal_loss: {
    id: 'signal_loss',
    label: 'Signal loss',
    description:
      'Signals start stable, then disappear mid-session. The room falls back to ambient light without pretending to measure.',
    demonstrates: 'The ambient fallback and the rule that stale samples never masquerade as valid.',
  },
};

export const SCENARIO_ORDER: SimulatorScenario[] = [
  'stable',
  'poor_lighting',
  'motion',
  'partial_signal',
  'signal_loss',
];

export const SIMULATION_DISCLOSURE =
  'SIMULATED SIGNALS — NOT SMARTSPECTRA DATA. This scenario is generated locally for interface review and judging when hardware is unavailable.';
