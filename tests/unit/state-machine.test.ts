import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '../../src/shared/constants';
import type { ConsentRecord } from '../../src/shared/contracts';
import {
  INITIAL_STATE,
  canStop,
  isActivePhase,
  isPreActivePhase,
  transition,
  type MachineEvent,
  type MachineState,
} from '../../src/shared/state-machine';

function consent(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    granted: true,
    version: CONSENT_VERSION,
    at: 1_760_000_000_000,
    camera: true,
    expression: false,
    simulator: false,
    ...overrides,
  };
}

function run(state: MachineState, events: MachineEvent[]): MachineState {
  let current = state;
  for (const event of events) {
    const result = transition(current, event);
    if (result.rejected) {
      throw new Error(`unexpected rejection for ${event.type}: ${result.reason}`);
    }
    current = result.state;
  }
  return current;
}

function rejected(state: MachineState, event: MachineEvent): string {
  const result = transition(state, event);
  expect(result.rejected).toBe(true);
  return result.reason ?? '';
}

describe('session state machine', () => {
  it('routes welcome to consent or setup according to key presence', () => {
    const toConsent = transition(INITIAL_STATE, { type: 'begin', keyPresent: true });
    expect(toConsent.rejected).toBe(false);
    expect(toConsent.state.phase).toBe('consent');
    expect(toConsent.state.keyPresent).toBe(true);

    const toSetup = transition(INITIAL_STATE, { type: 'begin', keyPresent: false });
    expect(toSetup.state.phase).toBe('setup_required');
    expect(toSetup.state.keyPresent).toBe(false);

    expect(rejected(INITIAL_STATE, { type: 'enter-room' })).toMatch(/only valid when ready/);
  });

  it('requires deliberate, current consent before requesting a live camera', () => {
    const consenting = run(INITIAL_STATE, [{ type: 'begin', keyPresent: true }]);

    expect(
      rejected(consenting, { type: 'enable-camera', consent: consent({ granted: false as true }) }),
    ).toMatch(/consent/);
    expect(
      rejected(consenting, { type: 'enable-camera', consent: consent({ version: '2019-01-01' }) }),
    ).toMatch(/consent/);
    expect(
      rejected(consenting, {
        type: 'enable-camera',
        consent: consent({ simulator: true }),
      }),
    ).toMatch(/simulator consent/);

    const granted = transition(consenting, { type: 'enable-camera', consent: consent() });
    expect(granted.rejected).toBe(false);
    expect(granted.state.phase).toBe('requesting_camera');
    expect(granted.state.mode).toBe('live');
  });

  it('refuses a live camera without a key even if consent is present', () => {
    const setup = run(INITIAL_STATE, [{ type: 'begin', keyPresent: false }]);
    const consenting = transition(setup, { type: 'key-missing' });
    expect(consenting.state.phase).toBe('setup_required');
    const forced = { ...consenting.state, phase: 'consent' as const };
    expect(rejected(forced, { type: 'enable-camera', consent: consent() })).toMatch(
      /API key is required/,
    );
  });

  it('walks camera permission into validation and calibration', () => {
    const state = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
      { type: 'camera-granted' },
    ]);
    expect(state.phase).toBe('validating_input');

    const calibrating = transition(state, { type: 'start-calibration' });
    expect(calibrating.state.phase).toBe('calibrating');

    const partial = transition(calibrating.state, {
      type: 'calibration-complete',
      partial: true,
    });
    expect(partial.state.phase).toBe('partial_signal_continue');
    expect(partial.state.partialAccepted).toBe(true);

    const ready = transition(calibrating.state, {
      type: 'calibration-complete',
      partial: false,
    });
    expect(ready.state.phase).toBe('ready');
    expect(ready.state.partialAccepted).toBe(false);
  });

  it('handles a denied camera without entering a session', () => {
    const requesting = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
    ]);
    const denied = transition(requesting, { type: 'camera-denied' });
    expect(denied.state.phase).toBe('permission_denied');
    expect(denied.state.consent).not.toBeNull();
    expect(canStop(denied.state.phase)).toBe(false);
  });

  it('never lets demo mode start once a live measurement is in progress', () => {
    const validating = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
      { type: 'camera-granted' },
    ]);
    expect(rejected(validating, { type: 'start-demo' })).toMatch(/live session is already/);

    const requesting = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
    ]);
    expect(rejected(requesting, { type: 'start-demo' })).toMatch(/not available|before a live/);

    const active = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
      { type: 'camera-granted' },
      { type: 'start-calibration' },
      { type: 'calibration-complete', partial: false },
      { type: 'enter-room' },
    ]);
    expect(rejected(active, { type: 'start-demo' })).toMatch(/not available|before a live/);
  });

  it('starts demo mode with explicit simulated consent', () => {
    const result = transition(INITIAL_STATE, {
      type: 'start-demo',
      scenario: 'signal_loss',
    });
    expect(result.rejected).toBe(false);
    expect(result.state.phase).toBe('demo');
    expect(result.state.mode).toBe('simulated');
    expect(result.state.scenario).toBe('signal_loss');
    expect(result.state.consent).toMatchObject({
      simulator: true,
      camera: false,
      granted: true,
      version: CONSENT_VERSION,
    });

    const calibrating = transition(result.state, { type: 'demo-ready' });
    expect(calibrating.state.phase).toBe('calibrating');
    expect(canStop(calibrating.state.phase)).toBe(true);
  });

  it('advances Arrive to Settle to Choose and stops into reflection', () => {
    const ready = run(INITIAL_STATE, [
      { type: 'start-demo', scenario: 'stable' },
      { type: 'demo-ready' },
      { type: 'calibration-complete', partial: false },
    ]);
    expect(ready.phase).toBe('ready');
    expect(isActivePhase(ready.phase)).toBe(false);

    const arrive = transition(ready, { type: 'enter-room' }).state;
    expect(arrive.phase).toBe('active.arrive');
    expect(isActivePhase(arrive.phase)).toBe(true);

    const settle = transition(arrive, { type: 'advance' }).state;
    expect(settle.phase).toBe('active.settle');
    const choose = transition(settle, { type: 'advance' }).state;
    expect(choose.phase).toBe('active.choose');
    const stopping = transition(choose, { type: 'advance' }).state;
    expect(stopping.phase).toBe('stopping');

    const reflection = transition(stopping, { type: 'stopped' }).state;
    expect(reflection.phase).toBe('reflection');
    const clearing = transition(reflection, { type: 'finish' }).state;
    expect(clearing.phase).toBe('clearing');

    const cleared = transition(clearing, { type: 'cleared' }).state;
    expect(cleared.phase).toBe('welcome');
    expect(cleared.mode).toBe('live');
    expect(cleared.consent).toBeNull();
    expect(cleared.error).toBeNull();
  });

  it('stops from any allowed pre-room stage and rejects stop when idle', () => {
    expect(canStop('welcome')).toBe(false);
    expect(canStop('consent')).toBe(false);
    expect(canStop('requesting_camera')).toBe(false);
    expect(canStop('demo')).toBe(true);
    expect(canStop('calibrating')).toBe(true);
    expect(canStop('partial_signal_continue')).toBe(true);
    expect(canStop('active.choose')).toBe(true);

    const demo = transition(INITIAL_STATE, { type: 'start-demo' }).state;
    const clearing = transition(demo, { type: 'stop' }).state;
    expect(clearing.phase).toBe('clearing');
    expect(clearing.consent).toBeNull();
  });

  it('returns to the correct step when starting another session', () => {
    const simulatedReflection = run(INITIAL_STATE, [
      { type: 'start-demo' },
      { type: 'demo-ready' },
      { type: 'calibration-complete', partial: false },
      { type: 'enter-room' },
      { type: 'advance' },
      { type: 'advance' },
      { type: 'choose-complete' },
      { type: 'stopped' },
    ]);
    const simulatedNext = transition(simulatedReflection, { type: 'start-another' }).state;
    expect(simulatedNext.phase).toBe('clearing');
    expect(simulatedNext.afterClear).toBe('demo');
    const simulatedCleared = transition(simulatedNext, { type: 'cleared' }).state;
    expect(simulatedCleared.phase).toBe('demo');
    expect(simulatedCleared.mode).toBe('simulated');

    const liveReflection = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
      { type: 'camera-granted' },
      { type: 'start-calibration' },
      { type: 'calibration-complete', partial: false },
      { type: 'enter-room' },
      { type: 'stop' },
      { type: 'stopped' },
    ]);
    const liveNext = transition(liveReflection, { type: 'start-another' }).state;
    expect(liveNext.afterClear).toBe('consent');
    const liveCleared = transition(liveNext, { type: 'cleared' }).state;
    expect(liveCleared.phase).toBe('consent');
    expect(liveCleared.consent).toBeNull();
  });

  it('keeps a recoverable error retryable but forbids replacing welcome or clearing', () => {
    const validating = run(INITIAL_STATE, [
      { type: 'begin', keyPresent: true },
      { type: 'enable-camera', consent: consent() },
      { type: 'camera-granted' },
    ]);
    const error = {
      code: 'NETWORK_ERROR',
      kind: 'recoverable' as const,
      title: 'Offline',
      message: 'The network request failed.',
      action: 'Retry.',
      retryable: true,
      sdkCode: 5,
      at: 1,
    };
    const failed = transition(validating, { type: 'error', error }).state;
    expect(failed.phase).toBe('recoverable_error');
    expect(failed.error?.code).toBe('NETWORK_ERROR');

    const retried = transition(failed, { type: 'retry' }).state;
    expect(retried.phase).toBe('requesting_camera');
    expect(retried.error).toBeNull();

    const fatal = transition(validating, {
      type: 'error',
      error: { ...error, kind: 'fatal', retryable: false },
    }).state;
    expect(fatal.phase).toBe('fatal_error');
    expect(rejected(fatal, { type: 'retry' })).toMatch(/only valid/);

    expect(
      rejected(INITIAL_STATE, {
        type: 'error',
        error,
      }),
    ).toMatch(/cannot replace/);
    expect(rejected({ ...INITIAL_STATE, phase: 'clearing' }, { type: 'error', error })).toMatch(
      /cannot replace/,
    );
  });

  it('back-welcome clears consent and simulator state but not from inside the room', () => {
    const demo = transition(INITIAL_STATE, { type: 'start-demo', scenario: 'motion' }).state;
    const welcome = transition(demo, { type: 'back-welcome' }).state;
    expect(welcome.phase).toBe('welcome');
    expect(welcome.mode).toBe('live');
    expect(welcome.consent).toBeNull();
    expect(welcome.scenario).toBeNull();

    const active = run(INITIAL_STATE, [
      { type: 'start-demo' },
      { type: 'demo-ready' },
      { type: 'calibration-complete', partial: false },
      { type: 'enter-room' },
    ]);
    expect(rejected(active, { type: 'back-welcome' })).toMatch(/not valid/);
  });

  it('classifies phases for camera and session guards', () => {
    expect(isPreActivePhase('welcome')).toBe(true);
    expect(isPreActivePhase('ready')).toBe(true);
    expect(isPreActivePhase('active.arrive')).toBe(false);
    expect(isActivePhase('active.choose')).toBe(true);
    expect(isActivePhase('reflection')).toBe(false);
  });
});
