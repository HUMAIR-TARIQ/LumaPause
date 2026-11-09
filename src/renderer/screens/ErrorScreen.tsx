import type { ReactNode } from 'react';
import type { SessionErrorInfo } from '../../shared/contracts';
import { Button, Eyebrow, Panel, StatusChip } from '../components/ui';

export function ErrorScreen({
  error,
  busy,
  onRetry,
  onDemo,
  onBack,
}: {
  error: SessionErrorInfo;
  busy: boolean;
  onRetry: () => void;
  onDemo: () => void;
  onBack: () => void;
}): ReactNode {
  const fatal = error.kind === 'fatal';

  return (
    <div className="screen screen--narrow error-screen">
      <Eyebrow>{fatal ? 'Session stopped' : 'Recoverable interruption'}</Eyebrow>
      <div
        className={`error-screen__mark${fatal ? ' error-screen__mark--fatal' : ''}`}
        aria-hidden="true"
      >
        <span />
      </div>
      <h1 className="title">{error.title}</h1>
      <p className="lede lede--small">{error.message}</p>

      <Panel className="error-panel">
        <StatusChip tone={fatal ? 'danger' : 'learning'}>
          {fatal ? 'Needs attention before another live session' : 'Can be retried'}
        </StatusChip>
        <p>{error.action}</p>
        <p className="fine-print">
          No video was recorded. If a camera track was open, it has already been released. The
          developer overlay (Ctrl/Cmd+Shift+D) preserves the diagnostic code
          {error.sdkCode === null ? '' : ` and SDK error ${error.sdkCode}`}.
        </p>
      </Panel>

      <div className="actions-row">
        {!fatal ? (
          <Button variant="primary" onClick={onRetry} disabled={busy}>
            Try again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDemo} disabled={busy}>
          Explore demo mode instead
        </Button>
        <Button variant="quiet" onClick={onBack} disabled={busy}>
          Return to welcome
        </Button>
      </div>

      <p className="fine-print">
        Demo mode is simulated and is labelled as such. It cannot stand in for a successful live
        SmartSpectra measurement.
      </p>
    </div>
  );
}
