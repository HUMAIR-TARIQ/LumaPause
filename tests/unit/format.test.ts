import { describe, expect, it } from 'vitest';
import type { ValidationState } from '../../src/shared/contracts';
import {
  availabilityText,
  formatDuration,
  formatSeconds,
  movementCopy,
  movementFromPhase,
  movementIndex,
  selfReportLabel,
  timeAgo,
  validationText,
} from '../../src/renderer/lib/format';

describe('renderer formatting helpers', () => {
  it('formats durations without negative or fractional output', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(125_400)).toBe('2:05');
    expect(formatDuration(-10)).toBe('0:00');
    expect(formatSeconds(0)).toBe('0s');
    expect(formatSeconds(4_400)).toBe('4s');
    expect(formatSeconds(-50)).toBe('0s');
  });

  it('maps only active phases to movements', () => {
    expect(movementFromPhase('active.arrive')).toBe('arrive');
    expect(movementFromPhase('active.settle')).toBe('settle');
    expect(movementFromPhase('active.choose')).toBe('choose');
    expect(movementFromPhase('ready')).toBeNull();
    expect(movementIndex('arrive')).toBe(0);
    expect(movementIndex('settle')).toBe(1);
    expect(movementIndex('choose')).toBe(2);
  });

  it('never asks the user to hit a target', () => {
    for (const movement of ['arrive', 'settle', 'choose'] as const) {
      const copy = movementCopy(movement);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.instruction).not.toMatch(/score|target heart|goal|diagnos/i);
    }
  });

  it('distinguishes measured and simulated availability text', () => {
    expect(availabilityText('ready')).toBe('Measured breathing and pulse');
    expect(availabilityText('partial')).toBe('Partial measured signal');
    expect(availabilityText('none')).toBe('Ambient light · no measured signal');

    expect(availabilityText('ready', true)).toBe('Simulated breathing and pulse');
    expect(availabilityText('partial', true)).toBe('Partial simulated signal');
    expect(availabilityText('none', true)).toBe('Ambient light · no simulated signal');
    expect(availabilityText('ready', true)).not.toMatch(/^Measured/);
  });

  it('falls back to camera guidance when no validation has arrived', () => {
    expect(validationText(null)).toEqual({
      label: 'Checking the camera',
      detail: 'Keep your face and upper chest in view while the sensor starts.',
      level: 'unknown',
    });

    const validation: ValidationState = {
      code: 12,
      label: 'Lots of movement',
      hint: 'Sit comfortably still while the room catches up.',
      officialHint: 'Excessive motion detected.',
      level: 'guidance',
      timestampUs: 1,
    };
    expect(validationText(validation)).toEqual({
      label: 'Lots of movement',
      detail: 'Sit comfortably still while the room catches up.',
      level: 'guidance',
    });
  });

  it('labels the voluntary self-report scale', () => {
    expect(selfReportLabel(1)).toBe('Not yet');
    expect(selfReportLabel(3)).toBe('Somewhere in between');
    expect(selfReportLabel(5)).toBe('Ready to begin');
    expect(selfReportLabel(0)).toBe('');
    expect(selfReportLabel(4.5)).toBe('');
  });

  it('describes sample age without showing impossible values', () => {
    expect(timeAgo(0, 1_000)).toBe('—');
    expect(timeAgo(Number.NaN, 1_000)).toBe('—');
    expect(timeAgo(1_000, 1_200)).toBe('now');
    expect(timeAgo(1_000, 3_600)).toBe('2.6s ago');
    expect(timeAgo(5_000, 1_000)).toBe('now');
  });
});
