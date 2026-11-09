import type { ReactNode } from 'react';
import { Button, Eyebrow, Panel } from '../components/ui';

/** Shown only when the secure preload bridge cannot be reached. */
export function StartupErrorScreen({ message }: { message: string }): ReactNode {
  return (
    <div className="screen screen--narrow error-screen">
      <Eyebrow>Startup</Eyebrow>
      <h1 className="title">LumaPause could not reach its secure bridge</h1>
      <p className="lede lede--small">
        The renderer loaded without the preload API, so consent, camera capture, and measurement are
        unavailable. This is a packaging or installation problem, not a camera problem.
      </p>
      <Panel className="error-panel">
        <p>{message}</p>
        <p className="fine-print">
          Quit LumaPause completely and start it again. If the message returns, reinstall the
          application or run <span className="mono-inline">npm run build</span> before launching.
        </p>
      </Panel>
      <div className="actions-row">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload the window
        </Button>
      </div>
    </div>
  );
}
