import 'dotenv/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CameraSelection,
  MetricType,
  SmartSpectraLogLevel,
  SmartSpectraSDK,
} = require('@smartspectra/node-sdk');

const apiKey = process.env.SMARTSPECTRA_API_KEY?.trim();
if (!apiKey) {
  console.error('[smoke] SMARTSPECTRA_API_KEY is missing from .env or this terminal.');
  process.exitCode = 2;
} else {
  let sdk;
  let terminal = false;
  let sawRunning = false;
  let sawMetric = false;

  const finish = async (code, message) => {
    if (terminal) return;
    terminal = true;
    clearTimeout(timeout);
    console.log(message);
    if (sdk) {
      try {
        await sdk.stopAsync();
      } catch {
        // The SDK can already be stopped after a terminal native error.
      }
      await sdk.destroy().catch(() => undefined);
    }
    process.exitCode = code;
  };

  const timeout = setTimeout(() => {
    void finish(
      sawRunning ? 0 : 1,
      sawRunning
        ? `[smoke] PASS: native camera processing ran${sawMetric ? ' and emitted metrics' : ''}.`
        : '[smoke] FAIL: the SDK did not reach its running state within 20 seconds.',
    );
  }, 20_000);

  try {
    const cameras = SmartSpectraSDK.availableCameras();
    console.log(
      `[smoke] SmartSpectra ${SmartSpectraSDK.version}; cameras discovered: ${cameras.length}`,
    );
    if (cameras.length === 0) throw new Error('No native camera was discovered.');

    sdk = new SmartSpectraSDK({
      apiKey,
      // Match the broadest LumaPause live request so this also validates the
      // key's entitlement for pulse and expression processing.
      requestedMetrics: [
        MetricType.CHEST_BREATHING,
        MetricType.BREATHING_RATE,
        MetricType.PULSE_RATE,
        MetricType.EXPRESSIONS,
      ],
      enableTelemetry: false,
      enableAccumulatedOutput: false,
      logLevel: SmartSpectraLogLevel.kWarning,
    });
    sdk.on('processingStatus', (status) => {
      console.log(`[smoke] processing status: ${status}`);
      if (status === 3) sawRunning = true;
    });
    sdk.on('validationStatus', (code, _timestampUs, hint) => {
      console.log(`[smoke] validation: ${code}${hint ? ` (${hint})` : ''}`);
    });
    sdk.on('metrics', () => {
      sawMetric = true;
    });
    sdk.on('error', (code, message, retryable) => {
      void finish(1, `[smoke] FAIL: SDK error ${code}: ${message} (retryable=${retryable})`);
    });

    sdk.useCamera(CameraSelection.byId(cameras[0].id), {
      width: 640,
      height: 480,
      fps: 30,
    });
    sdk.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish(1, `[smoke] FAIL: ${message}`);
  }
}
