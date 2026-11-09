import { useEffect, useRef, type ReactNode } from 'react';
import type { ProcessingState, SignalSnapshot } from '../../shared/contracts';
import { qualityLabel } from '../../shared/validation-guidance';
import type { CameraController } from '../camera/useCamera';
import { Button, Eyebrow, Panel, SignalRow, StatusChip } from '../components/ui';
import { validationText } from '../lib/format';

export function CameraCheckScreen({
  camera,
  snapshot,
  processing,
  busy,
  onContinue,
  onExit,
  onRetryCamera,
  onSelectCamera,
}: {
  camera: CameraController;
  snapshot: SignalSnapshot | null;
  processing: ProcessingState | null;
  busy: boolean;
  onContinue: () => void;
  onExit: () => void;
  onRetryCamera: () => void;
  onSelectCamera: (deviceId: string) => void;
}): ReactNode {
  const previewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = camera.stream;
  }, [camera.stream]);

  const stableSignals =
    (snapshot?.visual.measuredBreathing ? 1 : 0) + (snapshot?.visual.measuredPulse ? 1 : 0);
  const quality = qualityLabel(snapshot?.validation ?? null, stableSignals);
  const guidance = validationText(snapshot?.validation ?? null);
  const clear = snapshot?.validation?.code === 0;
  const waiting = camera.status === 'requesting' || !camera.stream;

  return (
    <div className="screen camera-check">
      <div className="screen-head">
        <div>
          <Eyebrow>Camera and signal check</Eyebrow>
          <h1 className="title">Bring your face and upper chest into view</h1>
        </div>
        <div className="screen-head__chips">
          <StatusChip tone={camera.status === 'live' ? 'good' : 'learning'}>
            {camera.status === 'live' ? 'Camera on' : 'Waiting for camera'}
          </StatusChip>
          <StatusChip tone={quality.tone === 'clear' ? 'good' : 'learning'}>
            {quality.text}
          </StatusChip>
        </div>
      </div>

      <div className="camera-grid">
        <div className="camera-panel">
          <div className="camera-frame">
            <video
              ref={previewRef}
              className="camera-frame__video"
              muted
              autoPlay
              playsInline
              aria-label="Live camera preview for framing"
            />
            {waiting ? (
              <div className="camera-frame__placeholder">
                <span className="camera-frame__placeholder-dot" aria-hidden="true" />
                <span>Waiting for camera permission…</span>
              </div>
            ) : null}
            <div className="framing-guide" aria-hidden="true">
              <span className="framing-guide__oval" />
              <span className="framing-guide__line" />
            </div>
            <span className="camera-frame__caption">Preview only · frames are not saved</span>
          </div>

          <div className="camera-controls">
            {camera.devices.length > 1 ? (
              <label className="field">
                <span>Camera</span>
                <select
                  value={camera.activeDeviceId ?? ''}
                  onChange={(event) => onSelectCamera(event.target.value)}
                  disabled={busy}
                >
                  {camera.devices.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="fine-print">
                {camera.devices.length === 1
                  ? 'Using the available camera.'
                  : 'Looking for cameras…'}
              </p>
            )}
            <div className="camera-controls__buttons">
              <Button variant="ghost" onClick={onRetryCamera} disabled={busy}>
                Retry camera
              </Button>
              <Button variant="quiet" onClick={onExit}>
                Exit
              </Button>
            </div>
          </div>
        </div>

        <Panel className="guidance-panel">
          <Eyebrow>Live guidance</Eyebrow>
          <h2>{guidance.label}</h2>
          <p>{guidance.detail}</p>
          <p className="fine-print">
            Guidance comes from SmartSpectra validation events. The raw code and timestamp stay in
            the developer overlay, not in the public interface.
          </p>

          <div className="signal-stack">
            <SignalRow
              label="Breathing"
              status={snapshot?.visual.measuredBreathing ? 'Stable' : 'Still learning'}
              tone={snapshot?.visual.measuredBreathing ? 'good' : 'learning'}
            />
            <SignalRow
              label="Pulse"
              status={snapshot?.visual.measuredPulse ? 'Stable' : 'Still learning'}
              tone={snapshot?.visual.measuredPulse ? 'good' : 'learning'}
            />
            <SignalRow
              label="Expression"
              status={
                snapshot?.expression
                  ? snapshot.expression.stable
                    ? 'Available'
                    : 'Still learning'
                  : 'Optional / not requested'
              }
              tone={snapshot?.expression?.stable ? 'good' : 'neutral'}
            />
          </div>

          <p className="fine-print">
            Sensor status: {processing?.label ?? 'Starting'}. Low confidence is normal while the
            model warms up; it is not a personal failure.
          </p>

          <div className="guidance-panel__actions">
            <Button variant="primary" onClick={onContinue} disabled={!clear || busy || waiting}>
              Start calibration
            </Button>
            <Button variant="ghost" onClick={onContinue} disabled={busy || waiting}>
              Calibrate anyway and keep checking
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
