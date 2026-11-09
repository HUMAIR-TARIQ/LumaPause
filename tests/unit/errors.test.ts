import { describe, expect, it } from 'vitest';
import {
  SDK_ERROR,
  SessionFailure,
  consentRequiredError,
  invalidStateError,
  mapSdkError,
  mapUnknownError,
  redactSecret,
} from '../../src/main/smartspectra/errors';

const SECRET = 'sk-live-abcdef1234567890';

describe('error mapping', () => {
  it('redacts a secret from arbitrary text', () => {
    expect(redactSecret(`key=${SECRET} rejected`, SECRET)).toBe('key=[redacted] rejected');
    expect(redactSecret('nothing to hide', SECRET)).toBe('nothing to hide');
    expect(redactSecret(`key=${SECRET}`, null)).toBe(`key=${SECRET}`);
    expect(redactSecret(`key=${SECRET}`, 'short')).toBe(`key=${SECRET}`);
  });

  it('maps authentication, configuration and credit failures as fatal', () => {
    for (const code of [
      SDK_ERROR.kAuthenticationFailed,
      SDK_ERROR.kConfigurationFailed,
      SDK_ERROR.kCreditExhausted,
    ]) {
      const info = mapSdkError(code, `provider said ${SECRET}`, true, SECRET);
      expect(info.kind).toBe('fatal');
      expect(info.retryable).toBe(false);
      expect(JSON.stringify(info)).not.toContain(SECRET);
    }
  });

  it('maps network, input, processing and timing failures as recoverable', () => {
    for (const code of [
      SDK_ERROR.kNetworkError,
      SDK_ERROR.kServerError,
      SDK_ERROR.kInputUnavailable,
      SDK_ERROR.kProcessingFailed,
      SDK_ERROR.kFrameConversionFailed,
      SDK_ERROR.kNonMonotonicTimestamp,
      SDK_ERROR.kTimestampGap,
      SDK_ERROR.kInvalidState,
    ]) {
      const info = mapSdkError(code, `message ${SECRET}`, false, SECRET);
      expect(info.kind).toBe('recoverable');
      expect(info.retryable).toBe(true);
      expect(JSON.stringify(info)).not.toContain(SECRET);
    }
  });

  it('honours the SDK retryable flag for unmapped codes and redacts the message', () => {
    const recoverable = mapSdkError(42, `boom ${SECRET}`, true, SECRET);
    expect(recoverable).toMatchObject({
      code: 'SDK_ERROR',
      kind: 'recoverable',
      retryable: true,
      sdkCode: 42,
    });
    expect(recoverable.message).not.toContain(SECRET);

    const fatal = mapSdkError(42, 'boom', false);
    expect(fatal.kind).toBe('fatal');
    expect(fatal.retryable).toBe(false);
  });

  it('produces consent and invalid-state failures with stable codes', () => {
    expect(consentRequiredError()).toMatchObject({
      code: 'CONSENT_REQUIRED',
      kind: 'fatal',
      retryable: false,
    });
    expect(invalidStateError('Not yet.')).toMatchObject({
      code: 'INVALID_STATE',
      kind: 'recoverable',
      message: 'Not yet.',
    });
  });

  it('maps unknown errors, numeric SDK errors and native runtime issues', () => {
    expect(mapUnknownError(new Error('plain failure'))).toMatchObject({
      code: 'UNEXPECTED_ERROR',
      kind: 'recoverable',
    });

    const numeric = Object.assign(new Error(`auth ${SECRET}`), { code: 2, retryable: true });
    const mapped = mapUnknownError(numeric, SECRET);
    expect(mapped.code).toBe('AUTH_FAILED');
    expect(mapped.message).not.toContain(SECRET);

    expect(mapUnknownError(new Error('Cannot open shared object file')).code).toBe(
      'NATIVE_RUNTIME_MISSING',
    );
    expect(mapUnknownError(new Error('LoadLibrary failed')).code).toBe('NATIVE_RUNTIME_MISSING');
    expect(mapUnknownError('string failure').code).toBe('UNEXPECTED_ERROR');
  });

  it('passes SessionFailure through without rewrapping', () => {
    const failure = new SessionFailure(invalidStateError('already mapped'));
    expect(mapUnknownError(failure)).toBe(failure.info);
  });
});
