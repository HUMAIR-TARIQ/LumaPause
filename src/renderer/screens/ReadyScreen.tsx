import type { ReactNode } from 'react';
import type { SignalSnapshot } from '../../shared/contracts';
import { Button, Eyebrow, Panel, SignalRow, StatusChip } from '../components/ui';

export function ReadyScreen({
  snapshot,
  simulated,
  busy,
  onEnter,
  onStop,
}: {
  snapshot: SignalSnapshot | null;
  simulated: boolean;
  busy: boolean;
  onEnter: () => void;
  onStop: () => void;
}): ReactNode {
  const breathing = Boolean(snapshot?.visual.measuredBreathing);
  const pulse = Boolean(snapshot?.visual.measuredPulse);

  return (
    <div className="screen screen--narrow ready">
      <Eyebrow>The room is ready</Eyebrow>
      <h1 className="title">Two quiet minutes, shaped by what the light can measure</h1>
      <p className="lede lede--small">
        The room uses measured breathing and pulse when they are fresh and stable. If a signal
        fades, it falls back to ambient light and says so. There is no target to hit.
      </p>

      <Panel className="ready-panel">
        <div className="ready-panel__signals">
          <SignalRow
            label="Breathing"
            status={simulated ? 'Simulated' : breathing ? 'Measured' : 'May be ambient'}
            tone={simulated ? 'warn' : breathing ? 'good' : 'learning'}
            detail="Moves the orb's size and pace."
          />
          <SignalRow
            label="Pulse"
            status={simulated ? 'Simulated' : pulse ? 'Measured' : 'May be ambient'}
            tone={simulated ? 'warn' : pulse ? 'good' : 'learning'}
            detail="Adds a slow ring of light at a safe frequency."
          />
        </div>
        <div className="ready-panel__note">
          <StatusChip tone="neutral">Stop is always available</StatusChip>
          <StatusChip tone="neutral">Numbers stay in the drawer</StatusChip>
        </div>
      </Panel>

      <div className="actions-row">
        <Button variant="primary" onClick={onEnter} disabled={busy}>
          Enter the room
        </Button>
        <Button variant="quiet" onClick={onStop} disabled={busy}>
          Stop and see reflection
        </Button>
      </div>
      <p className="fine-print">
        The room lasts about two minutes across Arrive, Settle, and Choose. Leaving early is allowed
        at any point.
      </p>
    </div>
  );
}
