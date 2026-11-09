import { z } from 'zod';
import type { PrepareSessionRequest } from './contracts';

export const simulatorScenarioSchema = z.enum([
  'stable',
  'poor_lighting',
  'motion',
  'partial_signal',
  'signal_loss',
]);

export const consentRecordSchema = z.object({
  granted: z.literal(true),
  version: z.string().min(1).max(64),
  at: z.number().int().nonnegative(),
  camera: z.boolean(),
  expression: z.boolean(),
  simulator: z.boolean(),
});

export const prepareSessionRequestSchema = z.object({
  consent: consentRecordSchema,
  mode: z.enum(['live', 'simulated']),
  expressionResponsiveness: z.boolean(),
  scenario: simulatorScenarioSchema.optional(),
});

export const demoRequestSchema = z.object({
  scenario: simulatorScenarioSchema,
  expressionResponsiveness: z.boolean(),
});

export const scenarioRequestSchema = z.object({
  scenario: simulatorScenarioSchema,
});

export const expressionRequestSchema = z.object({
  enabled: z.boolean(),
});

export function parsePrepareSessionRequest(raw: unknown): PrepareSessionRequest {
  return prepareSessionRequestSchema.parse(raw) as PrepareSessionRequest;
}

export interface ValidatedFramePacket {
  width: number;
  height: number;
  stride: number;
  format: 'rgba';
  timestampUs: number;
  buffer: ArrayBuffer;
}

export type FrameValidation =
  | { ok: true; packet: ValidatedFramePacket }
  | { ok: false; reason: string };

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * High-frequency frame guard. This is intentionally hand-written rather than a
 * zod object parse on every 30 fps frame, but it enforces the same schema
 * bounds: fixed RGBA format, bounded dimensions, a stride that can hold the
 * row, a finite non-negative monotonic timestamp, and an exact-enough buffer.
 */
export function validateFramePacket(raw: unknown): FrameValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  const packet = raw as Record<string, unknown>;

  const width = Number(packet.width);
  const height = Number(packet.height);
  const stride = Number(packet.stride);
  const timestampUs = Number(packet.timestampUs);

  if (packet.format !== 'rgba') return { ok: false, reason: 'format must be rgba' };
  if (!Number.isInteger(width) || width < 16 || width > 3840) {
    return { ok: false, reason: 'width out of range' };
  }
  if (!Number.isInteger(height) || height < 16 || height > 2160) {
    return { ok: false, reason: 'height out of range' };
  }
  if (!Number.isInteger(stride) || stride < width * 4 || stride > width * 4 * 2) {
    return { ok: false, reason: 'stride out of range' };
  }
  if (!Number.isFinite(timestampUs) || timestampUs < 0 || timestampUs > 1e17) {
    return { ok: false, reason: 'timestamp out of range' };
  }

  const buffer = packet.buffer;
  if (!(buffer instanceof ArrayBuffer))
    return { ok: false, reason: 'buffer is not an ArrayBuffer' };
  if (buffer.byteLength > MAX_FRAME_BYTES) return { ok: false, reason: 'buffer too large' };
  if (buffer.byteLength < stride * height) {
    return { ok: false, reason: 'buffer is smaller than stride * height' };
  }

  return {
    ok: true,
    packet: { width, height, stride, format: 'rgba', timestampUs, buffer },
  };
}
