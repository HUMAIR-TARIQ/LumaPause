import { describe, expect, it } from 'vitest';
import {
  VALIDATION_GUIDANCE,
  getValidationGuidance,
  mapValidation,
  qualityLabel,
} from '../../src/shared/validation-guidance';

describe('validation guidance', () => {
  it('maps every documented code to non-empty guidance', () => {
    for (const [code, guidance] of Object.entries(VALIDATION_GUIDANCE)) {
      expect(Number.isInteger(Number(code))).toBe(true);
      expect(guidance.label.length).toBeGreaterThan(0);
      expect(guidance.guidance.length).toBeGreaterThan(0);
      expect(['clear', 'guidance']).toContain(guidance.level);
    }
  });

  it('treats the clear code as clear and everything else as guidance', () => {
    expect(getValidationGuidance(0).level).toBe('clear');
    expect(getValidationGuidance(5)).toMatchObject({ label: 'Light looks low' });
    expect(getValidationGuidance(12)).toMatchObject({ label: 'Lots of movement' });
    expect(getValidationGuidance(999).level).toBe('unknown');
    expect(getValidationGuidance(999).label).toBe('Adjusting');
  });

  it('preserves the raw SDK code, hint and timestamp while adding human copy', () => {
    const state = mapValidation(5, 1_760_000_000_000_000, '  scene too dark  ');
    expect(state).toEqual({
      code: 5,
      label: 'Light looks low',
      hint: 'Add soft light in front of you.',
      officialHint: 'scene too dark',
      level: 'guidance',
      timestampUs: 1_760_000_000_000_000,
    });
  });

  it('never invents an official hint for an unknown code', () => {
    const state = mapValidation(999, 1, '');
    expect(state.officialHint).toBe('');
    expect(state.label).toBe('Adjusting');
  });

  it('describes quality in text so colour is never the only indicator', () => {
    expect(qualityLabel(null, 0)).toEqual({
      text: 'Waiting for the first signal check',
      tone: 'waiting',
    });
    expect(qualityLabel(mapValidation(0, 1, ''), 2)).toEqual({
      text: 'Clear signal',
      tone: 'clear',
    });
    expect(qualityLabel(mapValidation(0, 1, ''), 0)).toEqual({
      text: 'Framing looks good — still learning',
      tone: 'clear',
    });
    expect(qualityLabel(mapValidation(5, 1, ''), 3)).toEqual({
      text: 'Adjusting',
      tone: 'adjusting',
    });
  });
});
