import { useState, type ReactNode } from 'react';
import type { EnvironmentInfo } from '../../shared/contracts';
import { Button, Eyebrow, Panel, PrivacyLine, SignalRow, StatusChip } from '../components/ui';

export function ConsentScreen({
  env,
  onEnable,
  onDemo,
  onBack,
}: {
  env: EnvironmentInfo | null;
  onEnable: (expression: boolean) => void;
  onDemo: () => void;
  onBack: () => void;
}): ReactNode {
  const [consented, setConsented] = useState(false);
  const [expression, setExpression] = useState(false);

  return (
    <div className="screen screen--narrow consent">
      <Eyebrow>Informed consent</Eyebrow>
      <h1 className="title">You decide what the camera sees</h1>
      <p className="lede lede--small">
        LumaPause asks the SmartSpectra SDK for three signals. Two shape the room; one is optional.
        Nothing starts until you choose to enable the camera.
      </p>

      <Panel className="consent-panel">
        <div className="consent-panel__head">
          <h2>Requested signals</h2>
          <StatusChip tone="neutral">Processed on this device</StatusChip>
        </div>
        <SignalRow
          label="Pulse"
          status="Requested"
          tone="good"
          detail="A gentle light pulse and ring. The number stays behind the optional disclosure."
        />
        <SignalRow
          label="Breathing"
          status="Requested"
          tone="good"
          detail="Expansion and rhythm of the central orb. Breathing may take about 30 seconds to settle."
        />
        <SignalRow
          label="Facial-expression probabilities"
          status="Optional"
          tone="learning"
          detail="Only if you tick the box below. A high-confidence pattern can warm the palette; the scene never tells you what you feel."
        />

        <ul className="consent-list">
          <li>
            <strong>Processing location.</strong> SmartSpectra computes metrics on this device. The
            SDK contacts Presage only to validate your API key and subscription, not to compute
            metrics remotely.
          </li>
          <li>
            <strong>Telemetry.</strong> LumaPause constructs the SDK with{' '}
            <span className="mono-inline">enableTelemetry: false</span>. Presage receives no
            LumaPause usage telemetry.
          </li>
          <li>
            <strong>Storage.</strong> Raw frames are never recorded, saved, uploaded, or shared.
            Metric samples exist in memory only for the current session and are cleared when you
            stop.
          </li>
          <li>
            <strong>Agency.</strong> You can stop at any time. Stopping releases the camera track
            and the sensor session before reflection appears.
          </li>
          <li>
            <strong>Not medical.</strong> This is an informational, general-wellness reflection
            experience. It does not diagnose, treat, prevent, or monitor any condition.
          </li>
        </ul>

        <label className="check">
          <input
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
          />
          <span>
            I understand which camera-derived signals are requested, how they are used, and that I
            can stop at any time.
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={expression}
            onChange={(event) => setExpression(event.target.checked)}
          />
          <span>
            Include facial-expression probabilities for a subtle palette response (optional).
          </span>
        </label>
      </Panel>

      <PrivacyLine />

      <div className="actions-row">
        <Button variant="primary" onClick={() => onEnable(expression)} disabled={!consented}>
          Enable camera
        </Button>
        <Button variant="ghost" onClick={onDemo}>
          Continue without camera in demo mode
        </Button>
        <Button variant="quiet" onClick={onBack}>
          Back
        </Button>
      </div>

      <p className="fine-print">
        Demo mode uses synthetic signals and is always labelled “SIMULATED SIGNALS — NOT
        SMARTSPECTRA DATA”. An API key is required for live measurement
        {env?.keySource === 'dotenv' ? ' (loaded from the local .env)' : ''}.
      </p>
    </div>
  );
}
