import type { ReactNode } from 'react';
import type { SignalSnapshot } from '../../shared/contracts';
import { Button, Eyebrow, Panel, SignalRow, StatusChip } from '../components/ui';

export function PartialSignalScreen({
  snapshot,
  busy,
  onEnter,
  onKeepCalibrating,
  onStop,
}: {
  snapshot: SignalSnapshot | null;
  busy: boolean;
  onEnter: () => void;
  onKeepCalibrating: () => void;
  onStop: () => void;
}): ReactNode {
  const breathing = Boolean(snapshot?.visual.measuredBreathing);
  const pulse = Boolean(snapshot?.visual.measuredPulse);
  const none = !breathing && !pulse;

  return (
    <div className="screen screen--narrow partial">
      <Eyebrow>Partial signal</Eyebrow>
      <h1 className="title">
        {none
          ? 'An ambient room is available'
          : breathing && !pulse
            ? 'The room can follow breathing alone'
            : 'The room can follow pulse alone'}
      </h1>
      <p className="lede lede--small">
        {none
          ? 'No signal has reached the official stable threshold yet. The room can still run as ambient light, and it will not pretend to measure anything.'
          : 'One signal reached the stable threshold. The room will use it and leave the missing signal in ambient mode. Missing data is never shown as a reading.'}
      </p>

      <Panel className="partial-panel">
        <SignalRow
          label="Breathing"
          status={breathing ? 'Available' : 'Ambient only'}
          tone={breathing ? 'good' : 'neutral'}
        />
        <SignalRow
          label="Pulse"
          status={pulse ? 'Available' : 'Ambient only'}
          tone={pulse ? 'good' : 'neutral'}
        />
        <SignalRow
          label="Expression light"
          status={snapshot?.expression ? 'Optional' : 'Not available'}
          tone="neutral"
        />
      </Panel>

      <div className="actions-row">
        <Button variant="primary" onClick={onEnter} disabled={busy}>
          Enter the room with these signals
        </Button>
        <Button variant="ghost" onClick={onKeepCalibrating} disabled={busy}>
          Keep calibrating
        </Button>
        <Button variant="quiet" onClick={onStop} disabled={busy}>
          Stop and see reflection
        </Button>
      </div>

      <p className="fine-print">
        <StatusChip tone="learning">No health score</StatusChip> This screen describes measurement
        availability only. It makes no claim about how you feel or how ready you are.
      </p>
    </div>
  );
}
