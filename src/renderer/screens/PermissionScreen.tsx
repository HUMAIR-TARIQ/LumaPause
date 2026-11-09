import type { ReactNode } from 'react';
import type { CameraFailure } from '../camera/useCamera';
import { Button, Eyebrow, Panel, StatusChip } from '../components/ui';

export function PermissionScreen({
  failure,
  busy,
  onRetry,
  onDemo,
  onBack,
}: {
  failure: CameraFailure | null;
  busy: boolean;
  onRetry: () => void;
  onDemo: () => void;
  onBack: () => void;
}): ReactNode {
  return (
    <div className="screen screen--narrow permission-screen">
      <Eyebrow>Camera permission</Eyebrow>
      <h1 className="title">{failure?.title ?? 'The camera was not enabled'}</h1>
      <p className="lede lede--small">
        {failure?.message ??
          'LumaPause could not open a camera stream. No session has started and nothing is being captured.'}
      </p>

      <Panel className="permission-panel">
        <StatusChip tone="learning">Nothing is being captured</StatusChip>
        <p>
          {failure?.action ?? 'Check the system camera permission for LumaPause, then try again.'}
        </p>
        <p className="fine-print">
          You can also continue without a camera in demo mode. Demo signals are generated locally
          and are permanently labelled as simulated; they are not SmartSpectra measurements.
        </p>
      </Panel>

      <div className="actions-row">
        <Button variant="primary" onClick={onRetry} disabled={busy}>
          Try the camera again
        </Button>
        <Button variant="ghost" onClick={onDemo} disabled={busy}>
          Continue in demo mode
        </Button>
        <Button variant="quiet" onClick={onBack} disabled={busy}>
          Return to welcome
        </Button>
      </div>
    </div>
  );
}
