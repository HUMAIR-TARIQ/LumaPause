import type { ValidationLevel, ValidationState } from './contracts';

/**
 * Human guidance for the SmartSpectra ValidationCode enum.
 * Source: https://smartspectra.presagetech.com/docs/nodejs/api-reference.md#validationcode
 *
 * These are presentation mappings only. The raw code, official hint and timestamp
 * are always preserved in the snapshot and developer overlay.
 */
export interface ValidationGuidance {
  label: string;
  guidance: string;
  level: ValidationLevel;
}

export const VALIDATION_GUIDANCE: Record<number, ValidationGuidance> = {
  0: {
    label: 'Signal looks clear',
    guidance: 'Stay as you are for a moment while the room learns your rhythm.',
    level: 'clear',
  },
  1: {
    label: 'Face and chest not found',
    guidance: 'Center your face and upper chest in the frame.',
    level: 'guidance',
  },
  2: {
    label: 'More than one face',
    guidance: 'Keep one person in the frame for this session.',
    level: 'guidance',
  },
  3: {
    label: 'Face off center',
    guidance: 'Move gently toward the center of the frame.',
    level: 'guidance',
  },
  4: {
    label: 'Framing distance',
    guidance: 'Adjust how close you are so your face and upper chest fit comfortably.',
    level: 'guidance',
  },
  5: {
    label: 'Light looks low',
    guidance: 'Add soft light in front of you.',
    level: 'guidance',
  },
  6: {
    label: 'Light is very bright',
    guidance: 'Move away from a harsh light or window behind you.',
    level: 'guidance',
  },
  7: {
    label: 'Upper chest not visible',
    guidance: 'Lean back slightly so your upper chest is in view.',
    level: 'guidance',
  },
  10: {
    label: 'Camera tuning',
    guidance: 'Let the camera settle for a moment.',
    level: 'guidance',
  },
  11: {
    label: 'Frame rate too low',
    guidance: 'Close other camera apps or choose a faster camera.',
    level: 'guidance',
  },
  12: {
    label: 'Lots of movement',
    guidance: 'Sit comfortably still while the room catches up.',
    level: 'guidance',
  },
  13: {
    label: 'Face too close',
    guidance: 'Move the camera back a little.',
    level: 'guidance',
  },
  14: {
    label: 'Face too far',
    guidance: 'Move a little closer to the camera.',
    level: 'guidance',
  },
  15: {
    label: 'Face too high',
    guidance: 'Lower the camera or raise your seat slightly.',
    level: 'guidance',
  },
  16: {
    label: 'Face too low',
    guidance: 'Raise the camera to eye level.',
    level: 'guidance',
  },
  17: {
    label: 'Face turned away',
    guidance: 'Turn gently toward the camera and keep your head still.',
    level: 'guidance',
  },
};

const UNKNOWN_GUIDANCE: ValidationGuidance = {
  label: 'Adjusting',
  guidance: 'Settle into a comfortable position while the signals adjust.',
  level: 'unknown',
};

export function getValidationGuidance(code: number): ValidationGuidance {
  return VALIDATION_GUIDANCE[code] ?? UNKNOWN_GUIDANCE;
}

export function mapValidation(
  code: number,
  timestampUs: number,
  officialHint: string,
): ValidationState {
  const guidance = getValidationGuidance(code);
  return {
    code,
    label: guidance.label,
    hint: guidance.guidance,
    officialHint: officialHint.trim(),
    level: guidance.level,
    timestampUs,
  };
}

/** Text-only quality indicator so colour is never the only signal. */
export function qualityLabel(
  validation: ValidationState | null,
  stableSignals: number,
): { text: string; tone: 'clear' | 'adjusting' | 'waiting' } {
  if (!validation) {
    return { text: 'Waiting for the first signal check', tone: 'waiting' };
  }
  if (validation.code === 0 && stableSignals > 0) {
    return { text: 'Clear signal', tone: 'clear' };
  }
  if (validation.code === 0) {
    return { text: 'Framing looks good — still learning', tone: 'clear' };
  }
  return { text: 'Adjusting', tone: 'adjusting' };
}
