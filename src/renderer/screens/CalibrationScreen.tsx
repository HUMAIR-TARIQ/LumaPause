import type { ReactNode } from 'react';
import type { SignalSnapshot } from '../../shared/contracts';
import type { SessionTiming } from '../hooks/useSession';
import { formatSeconds, validationText } from '../lib/format';
import { Button, Eyebrow, Panel, SignalRow, StatusChip } from '../components/ui';

export function CalibrationScreen({
  snapshot,
  elapsedMs,
  progress,
  timing,
  offerPartial,
  busy,
  expressionConsented,
  simulated,
  onComplete,
  onPartial,
  onStop,
}: {
  snapshot: SignalSnapshot | null;
  elapsedMs: number;
  progress: number;
  timing: SessionTiming;
  offerPartial: boolean;
  busy: boolean;
  expressionConsented: boolean;
  simulated: boolean;
  onComplete: () => void;
  onPartial: () => void;
  onStop: () => void;
}): ReactNode {
  const breathing = Boolean(snapshot?.visual.measuredBreathing);
  const pulse = Boolean(snapshot?.visual.measuredPulse);
  const guidance = validationText(snapshot?.validation ?? null);
  const minReached = elapsedMs >= timing.minCalibrationMs;
  const canComplete = minReached && breathing && pulse;
  const canPartial = minReached && (breathing || pulse);
  const canAmbient = !breathing && !pulse && offerPartial;

  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <div className="screen calibration">
      <div className="screen-head">
        <div>
          <Eyebrow>Calibration</Eyebrow>
          <h1 className="title">Let the room learn your rhythm</h1>
        </div>
        <StatusChip tone="learning">Still learning</StatusChip>
      </div>

      <div className="calibration-grid">
        <div className="calibration-arc-wrap">
          <svg className="calibration-arc" viewBox="0 0 220 220" aria-hidden="true">
            <circle className="calibration-arc__track" cx="110" cy="110" r={radius} />
            <circle
              className="calibration-arc__value"
              cx="110"
              cy="110"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 110 110)"
            />
          </svg>
          <div className="calibration-arc__center">
            <span className="calibration-arc__time">{formatSeconds(elapsedMs)}</span>
            <span className="calibration-arc__label">
              of the {Math.round(timing.minCalibrationMs / 1000)}-second minimum window
            </span>
          </div>
        </div>

        <Panel className="calibration-panel">
          <h2>Some signals take time</h2>
          <p>
            The breathing model may need roughly thirty seconds before it reports a stable rate. Low
            confidence is shown as “still learning”; it is not a personal failure.
          </p>
          <p className="fine-print">
            {guidance.label}: {guidance.detail}
          </p>

          <div className="signal-stack">
            <SignalRow
              label="Breathing"
              status={breathing ? 'Stable' : 'Still learning'}
              tone={breathing ? 'good' : 'learning'}
              detail={
                snapshot?.breathingRate
                  ? `confidence ${Math.round(snapshot.breathingRate.confidence)} of 100`
                  : 'waiting for a stable sample'
              }
            />
            <SignalRow
              label="Pulse"
              status={pulse ? 'Stable' : 'Still learning'}
              tone={pulse ? 'good' : 'learning'}
              detail={
                snapshot?.pulse
                  ? `confidence ${Math.round(snapshot.pulse.confidence)} of 100`
                  : 'waiting for a stable sample'
              }
            />
            <SignalRow
              label="Expression"
              status={
                !expressionConsented
                  ? 'Not enabled'
                  : snapshot?.expression?.stable
                    ? 'Available'
                    : 'Optional / still learning'
              }
              tone={expressionConsented && snapshot?.expression?.stable ? 'good' : 'neutral'}
              detail={simulated ? 'simulated probabilities' : 'probabilities only'}
            />
          </div>

          <ul className="checklist">
            <li>Face and upper chest in view; soft light in front of you.</li>
            <li>Sit comfortably still and pause speaking while breathing settles.</li>
            <li>Keep the camera stable. Movement restarts the learning window temporarily.</li>
          </ul>

          <div className="guidance-panel__actions">
            <Button variant="primary" onClick={onComplete} disabled={!canComplete || busy}>
              Continue to the room
            </Button>
            {canPartial ? (
              <Button variant="ghost" onClick={onPartial} disabled={busy}>
                Continue with what is available
              </Button>
            ) : null}
            {canAmbient ? (
              <Button variant="ghost" onClick={onPartial} disabled={busy}>
                Continue with ambient light
              </Button>
            ) : null}
            <Button variant="quiet" onClick={onStop} disabled={busy}>
              Stop and see reflection
            </Button>
          </div>

          {!canComplete ? (
            <p className="fine-print">
              {!minReached
                ? 'The minimum window keeps the experience honest about how long the model needs.'
                : !breathing || !pulse
                  ? 'Continue unlocks when both breathing and pulse are stable, or choose a partial path.'
                  : null}
            </p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
