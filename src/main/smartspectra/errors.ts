import type { SessionErrorInfo } from '../../shared/contracts';

/**
 * SmartSpectra error codes, from the official Node.js API reference:
 * https://smartspectra.presagetech.com/docs/nodejs/api-reference.md#smartspectraerrorcode
 */
export const SDK_ERROR = {
  kOk: 0,
  kInvalidState: 1,
  kAuthenticationFailed: 2,
  kConfigurationFailed: 3,
  kCreditExhausted: 4,
  kNetworkError: 5,
  kServerError: 6,
  kInputUnavailable: 7,
  kProcessingFailed: 8,
  kFrameConversionFailed: 9,
  kNonMonotonicTimestamp: 10,
  kTimestampGap: 11,
} as const;

export class SessionFailure extends Error {
  readonly info: SessionErrorInfo;

  constructor(info: SessionErrorInfo) {
    super(info.message);
    this.name = 'SessionFailure';
    this.info = info;
  }
}

export function redactSecret(text: string, secret?: string | null): string {
  if (!secret || secret.length < 6) return text;
  return text.split(secret).join('[redacted]');
}

function info(
  code: string,
  kind: 'recoverable' | 'fatal',
  title: string,
  message: string,
  action: string,
  retryable: boolean,
  sdkCode: number | null,
): SessionErrorInfo {
  return {
    code,
    kind,
    title,
    message,
    action,
    retryable,
    sdkCode,
    at: Date.now(),
  };
}

export function mapSdkError(
  sdkCode: number,
  rawMessage: string,
  retryable: boolean,
  secret?: string | null,
): SessionErrorInfo {
  const message = redactSecret(rawMessage || '', secret);
  switch (sdkCode) {
    case SDK_ERROR.kAuthenticationFailed:
      return info(
        'AUTH_FAILED',
        'fatal',
        'SmartSpectra could not verify this key',
        'The API key was rejected, or the subscription could not be validated.',
        'Check SMARTSPECTRA_API_KEY in your local environment, restart LumaPause, or explore demo mode.',
        false,
        sdkCode,
      );
    case SDK_ERROR.kConfigurationFailed:
      return info(
        'CONFIGURATION_FAILED',
        'fatal',
        'The sensor configuration did not start',
        message || 'SmartSpectra could not configure the measurement pipeline.',
        'Try a supported platform, update the native runtime, or explore demo mode.',
        false,
        sdkCode,
      );
    case SDK_ERROR.kCreditExhausted:
      return info(
        'CREDIT_EXHAUSTED',
        'fatal',
        'This subscription has no measurement credit',
        'Presage accepted the key but the subscription has no remaining measurement credit.',
        'Check your Presage subscription, or explore demo mode.',
        false,
        sdkCode,
      );
    case SDK_ERROR.kNetworkError:
      return info(
        'NETWORK_ERROR',
        'recoverable',
        'Presage could not be reached',
        'SmartSpectra validates the API key and subscription online. The network request did not complete.',
        'Check your connection and try again. Metrics are computed locally once the session starts.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kServerError:
      return info(
        'SERVER_ERROR',
        'recoverable',
        'Presage is temporarily unavailable',
        message || 'The subscription validation service returned an error.',
        'Wait a moment and retry, or explore demo mode.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kInputUnavailable:
      return info(
        'INPUT_UNAVAILABLE',
        'recoverable',
        'The camera input is not available',
        'Another application may be using the camera, or the selected camera could not be opened.',
        'Close other camera apps, check Windows camera privacy settings, then retry.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kProcessingFailed:
      return info(
        'PROCESSING_FAILED',
        'recoverable',
        'SmartSpectra stopped processing',
        message || 'The measurement pipeline reported a processing failure.',
        'Retry to rebuild the sensor session.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kFrameConversionFailed:
      return info(
        'FRAME_CONVERSION_FAILED',
        'recoverable',
        'A camera frame could not be read',
        'The frame pipeline reported a conversion failure.',
        'Retry the session. If it repeats, try a different camera.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kNonMonotonicTimestamp:
    case SDK_ERROR.kTimestampGap:
      return info(
        'TIMESTAMP_ERROR',
        'recoverable',
        'The frame timing needs a reset',
        'The camera delivered frames with an unusable timestamp sequence.',
        'Retry the session to rebuild the frame clock.',
        true,
        sdkCode,
      );
    case SDK_ERROR.kInvalidState:
      return info(
        'INVALID_STATE',
        'recoverable',
        'The sensor was not ready for that action',
        message || 'SmartSpectra rejected a lifecycle transition.',
        'Retry to rebuild the session.',
        true,
        sdkCode,
      );
    default:
      return info(
        'SDK_ERROR',
        retryable ? 'recoverable' : 'fatal',
        'SmartSpectra reported an error',
        message || `The SDK reported error code ${sdkCode}.`,
        retryable
          ? 'Retry the session or explore demo mode.'
          : 'Explore demo mode or restart LumaPause.',
        retryable,
        sdkCode,
      );
  }
}

export function consentRequiredError(): SessionErrorInfo {
  return info(
    'CONSENT_REQUIRED',
    'fatal',
    'Informed consent is required',
    'The camera cannot start without a deliberate consent action for the current consent copy.',
    'Review the consent screen and enable the camera again.',
    false,
    null,
  );
}

export function invalidStateError(detail: string): SessionErrorInfo {
  return info(
    'INVALID_STATE',
    'recoverable',
    'That action is not available yet',
    detail,
    'Return to the previous step and try again.',
    true,
    null,
  );
}

export function mapUnknownError(error: unknown, secret?: string | null): SessionErrorInfo {
  if (error instanceof SessionFailure) return error.info;

  const raw = error instanceof Error ? error.message : String(error);
  const message = redactSecret(raw, secret);
  const numericCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? Number((error as { code?: unknown }).code)
      : NaN;

  if (Number.isFinite(numericCode) && numericCode >= 0 && numericCode <= 11) {
    const retryable =
      typeof error === 'object' && error !== null && 'retryable' in error
        ? Boolean((error as { retryable?: unknown }).retryable)
        : true;
    return mapSdkError(numericCode, message, retryable, secret);
  }

  if (/native runtime package|Cannot open shared object|LoadLibrary|ERR_DLOPEN/i.test(message)) {
    return info(
      'NATIVE_RUNTIME_MISSING',
      'fatal',
      'The SmartSpectra native runtime is missing',
      message,
      'Reinstall dependencies with npm install. Supported platforms are Windows x64, macOS Apple Silicon, and Linux x64/arm64.',
      false,
      null,
    );
  }

  return info(
    'UNEXPECTED_ERROR',
    'recoverable',
    'Something interrupted the sensor session',
    message || 'An unexpected error occurred while preparing the session.',
    'Retry the session, or explore demo mode while the issue is investigated.',
    true,
    null,
  );
}
