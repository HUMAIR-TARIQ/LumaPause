import { describe, expect, it } from 'vitest';
import { CONSENT_VERSION } from '../../src/shared/constants';
import {
  consentRecordSchema,
  demoRequestSchema,
  expressionRequestSchema,
  parsePrepareSessionRequest,
  prepareSessionRequestSchema,
  scenarioRequestSchema,
  simulatorScenarioSchema,
  validateFramePacket,
} from '../../src/shared/ipc-schemas';

const consent = {
  granted: true,
  version: CONSENT_VERSION,
  at: 1_760_000_000_000,
  camera: true,
  expression: false,
  simulator: false,
};

function prepare(overrides: Record<string, unknown> = {}) {
  return { consent, mode: 'live', expressionResponsiveness: false, ...overrides };
}

function frame(overrides: Record<string, unknown> = {}) {
  const width = 640;
  const height = 480;
  const stride = width * 4;
  return {
    width,
    height,
    stride,
    format: 'rgba',
    timestampUs: 1_760_000_000_000_000,
    buffer: new ArrayBuffer(stride * height),
    ...overrides,
  };
}

describe('IPC payload schemas', () => {
  it('accepts a complete prepare request and preserves optional fields', () => {
    const parsed = parsePrepareSessionRequest(prepare());
    expect(parsed).toEqual({
      consent,
      mode: 'live',
      expressionResponsiveness: false,
    });

    const simulated = parsePrepareSessionRequest(
      prepare({ mode: 'simulated', scenario: 'partial_signal' }),
    );
    expect(simulated.mode).toBe('simulated');
    expect(simulated.scenario).toBe('partial_signal');
  });

  it('rejects consent that was not granted or not versioned', () => {
    expect(prepareSessionRequestSchema.safeParse(prepare({ consent: null })).success).toBe(false);
    expect(
      prepareSessionRequestSchema.safeParse(prepare({ consent: { ...consent, granted: false } }))
        .success,
    ).toBe(false);
    expect(
      prepareSessionRequestSchema.safeParse(prepare({ consent: { ...consent, version: '' } }))
        .success,
    ).toBe(false);
    expect(consentRecordSchema.safeParse({ ...consent, at: -1 }).success).toBe(false);
    expect(consentRecordSchema.safeParse({ ...consent, at: 1.5 }).success).toBe(false);
  });

  it('rejects unknown modes, scenarios and missing flags', () => {
    expect(prepareSessionRequestSchema.safeParse(prepare({ mode: 'camera' })).success).toBe(false);
    expect(prepareSessionRequestSchema.safeParse(prepare({ scenario: 'earthquake' })).success).toBe(
      false,
    );
    expect(
      prepareSessionRequestSchema.safeParse({
        consent,
        mode: 'live',
      }).success,
    ).toBe(false);
    expect(simulatorScenarioSchema.safeParse('signal_loss').success).toBe(true);
    expect(simulatorScenarioSchema.safeParse('loss').success).toBe(false);
  });

  it('validates the smaller demo, scenario and expression requests', () => {
    expect(
      demoRequestSchema.safeParse({ scenario: 'motion', expressionResponsiveness: true }).success,
    ).toBe(true);
    expect(demoRequestSchema.safeParse({ scenario: 'motion' }).success).toBe(false);
    expect(scenarioRequestSchema.safeParse({ scenario: 'poor_lighting' }).success).toBe(true);
    expect(expressionRequestSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(expressionRequestSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('refuses prototype-polluted or extra-shape prepare payloads only when fields are invalid', () => {
    // zod strips unknown keys; unknown keys alone do not smuggle values into the
    // typed request.
    const parsed = parsePrepareSessionRequest(
      prepare({ unexpected: 'value', __proto__: { injected: true } }),
    );
    expect(Object.keys(parsed).sort()).toEqual(['consent', 'expressionResponsiveness', 'mode']);
  });
});

describe('frame packet guard', () => {
  it('accepts a correctly sized RGBA frame', () => {
    const result = validateFramePacket(frame());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.packet).toMatchObject({
      width: 640,
      height: 480,
      stride: 2560,
      format: 'rgba',
    });
    expect(result.packet.buffer.byteLength).toBe(640 * 480 * 4);
  });

  it('accepts a padded stride and an oversized buffer', () => {
    expect(
      validateFramePacket(
        frame({ stride: 640 * 4 * 2, buffer: new ArrayBuffer(640 * 4 * 2 * 480) }),
      ).ok,
    ).toBe(true);
    expect(validateFramePacket(frame({ buffer: new ArrayBuffer(640 * 480 * 4 + 512) })).ok).toBe(
      true,
    );
  });

  it('rejects non-objects and the wrong pixel format', () => {
    expect(validateFramePacket(null).ok).toBe(false);
    expect(validateFramePacket('frame').ok).toBe(false);
    expect(validateFramePacket(frame({ format: 'bgra' })).ok).toBe(false);
  });

  it('rejects out-of-range dimensions and strides', () => {
    expect(validateFramePacket(frame({ width: 15 })).ok).toBe(false);
    expect(validateFramePacket(frame({ width: 3841, stride: 3841 * 4 })).ok).toBe(false);
    expect(validateFramePacket(frame({ height: 15 })).ok).toBe(false);
    expect(validateFramePacket(frame({ height: 2161, buffer: new ArrayBuffer(1) })).ok).toBe(false);
    expect(validateFramePacket(frame({ width: 640.5 })).ok).toBe(false);
    expect(validateFramePacket(frame({ stride: 2_559 })).ok).toBe(false);
    expect(
      validateFramePacket(frame({ stride: 5_121, buffer: new ArrayBuffer(5_121 * 480) })).ok,
    ).toBe(false);
  });

  it('rejects bad timestamps', () => {
    expect(validateFramePacket(frame({ timestampUs: -1 })).ok).toBe(false);
    expect(validateFramePacket(frame({ timestampUs: Number.NaN })).ok).toBe(false);
    expect(validateFramePacket(frame({ timestampUs: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(validateFramePacket(frame({ timestampUs: 2e17 })).ok).toBe(false);
    expect(validateFramePacket(frame({ timestampUs: 0 })).ok).toBe(true);
  });

  it('rejects a buffer that is not an ArrayBuffer or is too small', () => {
    expect(validateFramePacket(frame({ buffer: new Uint8Array(640 * 480 * 4) })).ok).toBe(false);
    expect(validateFramePacket(frame({ buffer: new ArrayBuffer(640 * 480 * 4 - 1) })).ok).toBe(
      false,
    );
  });

  it('rejects buffers above the 64 MiB ceiling', () => {
    const oversized = new ArrayBuffer(64 * 1024 * 1024 + 1);
    const result = validateFramePacket(
      frame({ width: 3840, height: 2160, stride: 3840 * 4, buffer: oversized }),
    );
    expect(result).toEqual({ ok: false, reason: 'buffer too large' });
  });
});
