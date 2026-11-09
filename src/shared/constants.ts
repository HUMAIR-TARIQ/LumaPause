/**
 * Product-wide constants.
 *
 * Confidence thresholds are taken from the official SmartSpectra model cards:
 *  - Breathing rate: stable at confidence >= 45 (accuracy standard +/-1 br/min)
 *  - Heart rate / arterial pressure: stable at confidence >= 40 (accuracy standard +/-3 bpm)
 *    https://vandv.presagetech.com/breathing_model_card.html
 *    https://vandv.presagetech.com/arterial_pressure_model_card.html
 *
 * The SDK already sets `stable` using those thresholds. LumaPause checks both the
 * flag and the documented confidence value so a malformed or partial payload can
 * never masquerade as a valid reading.
 */

export const APP_NAME = 'LumaPause';
export const APP_TAGLINE =
  'A private pre-performance reset room that responds to your breathing, pulse, and presence.';

export const CONSENT_VERSION = '2026-11-09';
export const CONSENT_COPY_VERSION_NOTE =
  'Changing the consent copy requires bumping CONSENT_VERSION.';

/** SDK stable thresholds, see file header. */
export const BREATHING_CONFIDENCE_THRESHOLD = 45;
export const PULSE_CONFIDENCE_THRESHOLD = 40;
/**
 * Product threshold for expression colour influence. The model does not define a
 * clinical threshold for expression display; LumaPause requires a high-confidence,
 * stable distribution before any colour influence is applied.
 */
export const EXPRESSION_CONFIDENCE_THRESHOLD = 55;

/** A sample older than this is treated as unavailable, not carried forward. */
export const SAMPLE_STALE_MS = 5_000;

/**
 * Sanity guards against malformed payloads. These are not medical ranges and
 * are never shown to the user as judgements.
 */
export const PULSE_SANITY_MIN = 20;
export const PULSE_SANITY_MAX = 260;
export const BREATHING_SANITY_MIN = 2;
export const BREATHING_SANITY_MAX = 80;

/** Calibration is consistent with the official note that breathing can take ~30s. */
export const MIN_CALIBRATION_MS = 30_000;
/** After this, offer an explicit "continue with what is available" path. */
export const CALIBRATION_PARTIAL_OFFER_MS = 45_000;

/** Responsive room: 2 minutes across three movements. */
export const ROOM_TOTAL_MS = 120_000;
export const MOVEMENT_DURATIONS_MS = {
  arrive: 35_000,
  settle: 50_000,
  choose: 35_000,
} as const;

/** Rendering and telemetry cadences. */
export const SNAPSHOT_INTERVAL_MS = 100;
export const OVERLAY_THROTTLE_MS = 250;
export const STATUS_THROTTLE_MS = 300;

/** Bounded in-memory history (no persistence). */
export const MAX_WAVEFORM_SAMPLES = 600;
export const MAX_METRIC_SAMPLES = 120;
export const MAX_COVERAGE_BINS = 900;
export const COVERAGE_BIN_MS = 1_000;

/** Visual clamps. */
export const BREATH_SCALE_MIN = 0.9;
export const BREATH_SCALE_MAX = 1.1;
export const PULSE_GLOW_MIN = 0.12;
export const PULSE_GLOW_MAX = 1;
export const PULSE_VISUAL_HZ_MIN = 0.2;
export const PULSE_VISUAL_HZ_MAX = 0.45;
export const BREATHING_PERIOD_MIN_MS = 3_500;
export const BREATHING_PERIOD_MAX_MS = 9_000;
export const WAVEFORM_WINDOW_MS = 10_000;

/** Capture target. Sent to the renderer and used by the frame worker. */
// SmartSpectra's Electron capture path is tuned for a 16:9 720p stream. The
// frame pump may scale smaller cameras down proportionally, but must never
// stretch a 16:9 camera into 4:3 (that distorts the face/chest geometry).
export const CAPTURE_WIDTH = 1280;
export const CAPTURE_HEIGHT = 720;
export const CAPTURE_FPS = 30;
export const CAPTURE_MIN_FPS = 15;

/** Private IPC channel names. The preload surface is the only consumer. */
export const IPC = {
  environment: 'lumapause:environment',
  status: 'lumapause:status',
  prepare: 'lumapause:session:prepare',
  start: 'lumapause:session:start',
  stop: 'lumapause:session:stop',
  finish: 'lumapause:session:finish',
  retry: 'lumapause:session:retry',
  demo: 'lumapause:session:demo',
  scenario: 'lumapause:session:scenario',
  expression: 'lumapause:session:expression',
  roomStart: 'lumapause:session:room-start',
  framePort: 'lumapause:frames:port',
  event: 'lumapause:event',
} as const;

export const DISCLAIMER =
  'LumaPause is a general-wellness reflection experience, not a medical device. It does not diagnose, treat, prevent, or monitor any condition. If you feel unwell, stop and seek appropriate care.';

export const PRIVACY_HEADLINE = 'Your camera stays on this device. No video is recorded.';

export const EXPRESSION_WEIGHTS: Record<string, number> = {
  HAPPY: 1,
  NEUTRAL: 0.15,
  SURPRISE: 0.45,
  SAD: -0.55,
  ANGRY: -0.7,
  FEAR: -0.5,
  DISGUST: -0.65,
  CONTEMPT: -0.45,
  UNSPECIFIED: 0,
};

export const SCENARIO_LABELS = {
  stable: 'Stable signals',
  poor_lighting: 'Poor lighting',
  motion: 'Movement',
  partial_signal: 'Breathing only',
  signal_loss: 'Signal loss',
} as const;
