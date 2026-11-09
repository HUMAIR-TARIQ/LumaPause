import type {
  SessionPhase,
  SignalAvailability,
  SignalSnapshot,
  ValidationLevel,
} from '../../shared/contracts';

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

export type Movement = 'arrive' | 'settle' | 'choose';

export function movementFromPhase(phase: SessionPhase): Movement | null {
  if (phase === 'active.arrive') return 'arrive';
  if (phase === 'active.settle') return 'settle';
  if (phase === 'active.choose') return 'choose';
  return null;
}

export function movementIndex(movement: Movement): number {
  return movement === 'arrive' ? 0 : movement === 'settle' ? 1 : 2;
}

export function movementCopy(movement: Movement): { title: string; instruction: string } {
  switch (movement) {
    case 'arrive':
      return {
        title: 'Arrive',
        instruction: 'Rest your eyes on the light. Nothing is required right now.',
      };
    case 'settle':
      return {
        title: 'Settle',
        instruction: 'Follow the light only if it feels comfortable. There is no target to reach.',
      };
    case 'choose':
      return {
        title: 'Choose',
        instruction: 'Name one small intention for what comes next.',
      };
  }
}

export function availabilityText(availability: SignalAvailability, simulated = false): string {
  if (simulated) {
    switch (availability) {
      case 'ready':
        return 'Simulated breathing and pulse';
      case 'partial':
        return 'Partial simulated signal';
      default:
        return 'Ambient light · no simulated signal';
    }
  }
  switch (availability) {
    case 'ready':
      return 'Measured breathing and pulse';
    case 'partial':
      return 'Partial measured signal';
    default:
      return 'Ambient light · no measured signal';
  }
}

export function validationText(validation: SignalSnapshot['validation']): {
  label: string;
  detail: string;
  level: ValidationLevel;
} {
  if (!validation) {
    return {
      label: 'Checking the camera',
      detail: 'Keep your face and upper chest in view while the sensor starts.',
      level: 'unknown',
    };
  }
  return { label: validation.label, detail: validation.hint, level: validation.level };
}

export function selfReportLabel(value: number): string {
  switch (value) {
    case 1:
      return 'Not yet';
    case 2:
      return 'Still gathering';
    case 3:
      return 'Somewhere in between';
    case 4:
      return 'Mostly ready';
    case 5:
      return 'Ready to begin';
    default:
      return '';
  }
}

export function timeAgo(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  const age = Math.max(0, now - timestamp);
  if (age < 1500) return 'now';
  return `${(age / 1000).toFixed(1)}s ago`;
}
