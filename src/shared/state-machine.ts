import { CONSENT_VERSION } from './constants';
import type {
  ConsentRecord,
  Mode,
  SessionErrorInfo,
  SessionPhase,
  SimulatorScenario,
} from './contracts';

export interface MachineState {
  phase: SessionPhase;
  mode: Mode;
  keyPresent: boolean;
  consent: ConsentRecord | null;
  scenario: SimulatorScenario | null;
  afterClear: SessionPhase;
  error: SessionErrorInfo | null;
  /** Set when the user explicitly accepts a partial signal during calibration. */
  partialAccepted: boolean;
}

export type MachineEvent =
  | { type: 'begin'; keyPresent: boolean }
  | { type: 'key-missing' }
  | { type: 'enable-camera'; consent: ConsentRecord }
  | { type: 'camera-granted' }
  | { type: 'camera-denied' }
  | { type: 'start-demo'; scenario?: SimulatorScenario }
  | { type: 'demo-ready' }
  | { type: 'start-calibration' }
  | { type: 'calibration-complete'; partial: boolean }
  | { type: 'enter-partial' }
  | { type: 'keep-calibrating' }
  | { type: 'enter-room' }
  | { type: 'advance' }
  | { type: 'choose-complete' }
  | { type: 'stop' }
  | { type: 'stopped' }
  | { type: 'finish' }
  | { type: 'start-another' }
  | { type: 'cleared' }
  | { type: 'retry' }
  | { type: 'back-welcome' }
  | { type: 'error'; error: SessionErrorInfo };

export interface TransitionResult {
  state: MachineState;
  rejected: boolean;
  reason?: string;
}

export const INITIAL_STATE: MachineState = {
  phase: 'welcome',
  mode: 'live',
  keyPresent: false,
  consent: null,
  scenario: null,
  afterClear: 'welcome',
  error: null,
  partialAccepted: false,
};

const ACTIVE_PHASES: SessionPhase[] = ['active.arrive', 'active.settle', 'active.choose'];
const PRE_ACTIVE_PHASES: SessionPhase[] = [
  'welcome',
  'consent',
  'setup_required',
  'requesting_camera',
  'validating_input',
  'calibrating',
  'ready',
  'partial_signal_continue',
  'demo',
  'permission_denied',
  'recoverable_error',
  'fatal_error',
];

export function isActivePhase(phase: SessionPhase): boolean {
  return ACTIVE_PHASES.includes(phase);
}

export function isPreActivePhase(phase: SessionPhase): boolean {
  return PRE_ACTIVE_PHASES.includes(phase);
}

export function canStop(phase: SessionPhase): boolean {
  return (
    isActivePhase(phase) ||
    phase === 'validating_input' ||
    phase === 'calibrating' ||
    phase === 'ready' ||
    phase === 'partial_signal_continue' ||
    phase === 'demo'
  );
}

function reject(state: MachineState, reason: string): TransitionResult {
  return { state, rejected: true, reason };
}

function move(state: MachineState, patch: Partial<MachineState>): TransitionResult {
  return { state: { ...state, ...patch }, rejected: false };
}

function validConsent(consent: ConsentRecord | null): boolean {
  return Boolean(
    consent &&
      consent.granted === true &&
      consent.version === CONSENT_VERSION &&
      Number.isFinite(consent.at),
  );
}

/**
 * Explicit, React-independent session state machine.
 * Impossible transitions are rejected rather than silently coerced.
 */
export function transition(state: MachineState, event: MachineEvent): TransitionResult {
  switch (event.type) {
    case 'begin':
      if (state.phase !== 'welcome') return reject(state, 'begin is only valid from welcome');
      return move(state, {
        keyPresent: event.keyPresent,
        phase: event.keyPresent ? 'consent' : 'setup_required',
      });

    case 'key-missing':
      if (state.phase !== 'welcome' && state.phase !== 'consent') {
        return reject(state, 'key-missing is only valid before camera consent');
      }
      return move(state, { phase: 'setup_required', keyPresent: false });

    case 'enable-camera':
      if (state.phase !== 'consent')
        return reject(state, 'camera can only be enabled from consent');
      if (!validConsent(event.consent)) return reject(state, 'informed consent is required');
      if (!state.keyPresent) return reject(state, 'an API key is required for live mode');
      if (event.consent.simulator)
        return reject(state, 'simulator consent cannot enable a live camera');
      return move(state, {
        mode: 'live',
        consent: event.consent,
        phase: 'requesting_camera',
        error: null,
      });

    case 'camera-granted':
      if (state.phase !== 'requesting_camera') {
        return reject(state, 'camera-granted is only valid while requesting the camera');
      }
      return move(state, { phase: 'validating_input' });

    case 'camera-denied':
      if (state.phase !== 'requesting_camera') {
        return reject(state, 'camera-denied is only valid while requesting the camera');
      }
      return move(state, { phase: 'permission_denied' });

    case 'start-demo': {
      if (!isPreActivePhase(state.phase) || state.phase === 'requesting_camera') {
        return reject(state, 'demo mode is only available before a live session starts');
      }
      if (
        state.phase === 'validating_input' ||
        state.phase === 'calibrating' ||
        state.phase === 'ready' ||
        state.phase === 'partial_signal_continue'
      ) {
        return reject(state, 'a live session is already in progress');
      }
      const now = Date.now();
      return move(state, {
        mode: 'simulated',
        scenario: event.scenario ?? 'stable',
        phase: 'demo',
        consent: {
          granted: true,
          version: CONSENT_VERSION,
          at: now,
          camera: false,
          expression: true,
          simulator: true,
        },
        error: null,
        partialAccepted: false,
      });
    }

    case 'demo-ready':
      if (state.phase !== 'demo') return reject(state, 'demo-ready is only valid in demo setup');
      return move(state, { phase: 'calibrating', afterClear: 'welcome' });

    case 'start-calibration':
      if (state.phase !== 'validating_input') {
        return reject(state, 'calibration can only start from the camera check');
      }
      return move(state, { phase: 'calibrating' });

    case 'calibration-complete':
      if (state.phase !== 'calibrating') {
        return reject(state, 'calibration-complete is only valid during calibration');
      }
      return move(state, {
        phase: event.partial ? 'partial_signal_continue' : 'ready',
        partialAccepted: event.partial,
      });

    case 'enter-partial':
      if (state.phase !== 'partial_signal_continue') {
        return reject(state, 'enter-partial is only valid on the partial signal screen');
      }
      return move(state, { phase: 'active.arrive', partialAccepted: true });

    case 'keep-calibrating':
      if (state.phase !== 'partial_signal_continue') {
        return reject(state, 'keep-calibrating is only valid on the partial signal screen');
      }
      return move(state, { phase: 'calibrating', partialAccepted: false });

    case 'enter-room':
      if (state.phase !== 'ready') return reject(state, 'enter-room is only valid when ready');
      return move(state, { phase: 'active.arrive' });

    case 'advance':
      if (state.phase === 'active.arrive') return move(state, { phase: 'active.settle' });
      if (state.phase === 'active.settle') return move(state, { phase: 'active.choose' });
      if (state.phase === 'active.choose') {
        return move(state, { phase: 'stopping', afterClear: 'welcome' });
      }
      return reject(state, 'advance is only valid inside the responsive room');

    case 'choose-complete':
      if (state.phase !== 'active.choose') {
        return reject(state, 'choose-complete is only valid in the choose movement');
      }
      return move(state, { phase: 'stopping', afterClear: 'welcome' });

    case 'stop':
      if (state.phase === 'demo') {
        return move(state, {
          phase: 'clearing',
          afterClear: 'welcome',
          consent: null,
          scenario: null,
          partialAccepted: false,
        });
      }
      if (!canStop(state.phase)) return reject(state, 'stop is not valid in this phase');
      return move(state, { phase: 'stopping', afterClear: 'welcome' });

    case 'stopped':
      if (state.phase !== 'stopping') return reject(state, 'stopped is only valid while stopping');
      return move(state, { phase: 'reflection' });

    case 'finish':
      if (state.phase !== 'reflection') return reject(state, 'finish is only valid in reflection');
      return move(state, { phase: 'clearing', afterClear: 'welcome' });

    case 'start-another': {
      if (state.phase !== 'reflection') {
        return reject(state, 'start-another is only valid in reflection');
      }
      const next: SessionPhase =
        state.mode === 'simulated' ? 'demo' : state.keyPresent ? 'consent' : 'setup_required';
      return move(state, {
        phase: 'clearing',
        afterClear: next,
        partialAccepted: false,
      });
    }

    case 'cleared':
      if (state.phase !== 'clearing') return reject(state, 'cleared is only valid while clearing');
      return move(state, {
        phase: state.afterClear,
        mode: state.afterClear === 'demo' ? 'simulated' : 'live',
        consent: null,
        error: null,
        partialAccepted: false,
        afterClear: 'welcome',
      });

    case 'retry':
      if (state.phase !== 'recoverable_error' && state.phase !== 'permission_denied') {
        return reject(state, 'retry is only valid after a camera or recoverable error');
      }
      if (state.mode === 'simulated') return move(state, { phase: 'demo', error: null });
      if (!validConsent(state.consent)) return move(state, { phase: 'consent', error: null });
      return move(state, { phase: 'requesting_camera', error: null });

    case 'back-welcome':
      if (
        state.phase === 'setup_required' ||
        state.phase === 'permission_denied' ||
        state.phase === 'recoverable_error' ||
        state.phase === 'fatal_error' ||
        state.phase === 'consent' ||
        state.phase === 'demo' ||
        // A deliberate exit from a pre-room camera stage. The controller stops
        // the SDK and camera before dispatching this event.
        state.phase === 'validating_input' ||
        state.phase === 'calibrating' ||
        state.phase === 'ready' ||
        state.phase === 'partial_signal_continue'
      ) {
        return move(state, {
          phase: 'welcome',
          mode: 'live',
          consent: null,
          scenario: null,
          error: null,
          partialAccepted: false,
        });
      }
      return reject(state, 'back-welcome is not valid in this phase');

    case 'error':
      if (state.phase === 'clearing' || state.phase === 'welcome') {
        return reject(state, 'errors cannot replace the welcome or clearing screen');
      }
      return move(state, {
        phase: event.error.kind === 'fatal' ? 'fatal_error' : 'recoverable_error',
        error: event.error,
      });

    default:
      return reject(state, 'unknown event');
  }
}

export function applyEvents(state: MachineState, events: MachineEvent[]): TransitionResult[] {
  const results: TransitionResult[] = [];
  let current = state;
  for (const event of events) {
    const result = transition(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
}
