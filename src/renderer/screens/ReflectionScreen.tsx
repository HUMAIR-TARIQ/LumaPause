import type { ReactNode } from 'react';
import type { SessionFacts, SignalSnapshot } from '../../shared/contracts';
import { Button, CameraOffBadge, Eyebrow, Panel, StatusChip } from '../components/ui';
import { formatDuration, selfReportLabel } from '../lib/format';

function signalSummary(available: {
  pulse: boolean;
  breathing: boolean;
  expression: boolean;
}): string {
  const labels: string[] = [];
  if (available.breathing) labels.push('breathing');
  if (available.pulse) labels.push('pulse');
  if (available.expression) labels.push('expression patterns');
  if (labels.length === 0) return 'Ambient light only';
  return labels.join(', ');
}

export function ReflectionScreen({
  facts,
  snapshot,
  intention,
  selfReport,
  busy,
  simulated,
  onSelfReport,
  onFinish,
  onAnother,
}: {
  facts: SessionFacts | null;
  snapshot: SignalSnapshot | null;
  intention: string;
  selfReport: number | null;
  busy: boolean;
  simulated: boolean;
  onSelfReport: (value: number) => void;
  onFinish: () => void;
  onAnother: () => void;
}): ReactNode {
  const duration = facts?.durationMs ?? snapshot?.sessionElapsedMs ?? 0;
  const roomDuration = facts?.roomDurationMs ?? snapshot?.roomElapsedMs ?? 0;
  const calibrationDuration = facts?.calibrationDurationMs ?? 0;
  const available = facts?.signalsAvailable ??
    snapshot?.signalsEverAvailable ?? {
      pulse: false,
      breathing: false,
      expression: false,
    };
  const coverage = facts?.stableCoveragePercent ?? snapshot?.stableCoverage.percent ?? 0;
  const trimmed = intention.trim();

  return (
    <div className="screen screen--narrow reflection">
      <Eyebrow>Reflection</Eyebrow>
      <h1 className="title">The room is quiet again</h1>
      <p className="lede lede--small">
        Here is what happened, without interpretation. LumaPause does not score you, compare
        readings over time, or claim that anything improved.
      </p>

      <CameraOffBadge simulated={simulated} />

      <div className="reflection-grid">
        <Panel className="facts-panel">
          <div className="facts-panel__head">
            <h2>Session facts</h2>
            <StatusChip tone="neutral">Held in memory</StatusChip>
          </div>
          <dl className="facts-list">
            <div>
              <dt>Total session</dt>
              <dd className="numeric">{formatDuration(duration)}</dd>
            </div>
            <div>
              <dt>Time in the room</dt>
              <dd className="numeric">{formatDuration(roomDuration)}</dd>
            </div>
            <div>
              <dt>Calibration</dt>
              <dd className="numeric">{formatDuration(calibrationDuration)}</dd>
            </div>
            <div>
              <dt>Signals available</dt>
              <dd>{signalSummary(available)}</dd>
            </div>
            <div>
              <dt>Stable signal</dt>
              <dd className="numeric">about {Math.round(coverage)}% of the session</dd>
            </div>
          </dl>
          <p className="fine-print">
            “Available” means at least one fresh sample reached the official stable threshold at
            some point. Coverage is an approximate share of the session, not a health measure.
          </p>
        </Panel>

        <Panel className="intention-panel">
          <h2>Your intention</h2>
          {trimmed ? (
            <blockquote className="intention-quote">{trimmed}</blockquote>
          ) : (
            <p className="fine-print">
              No intention was written this time. That is allowed; the room does not require one.
            </p>
          )}
          <p className="fine-print">
            The intention lives only in this window’s memory until you finish.
          </p>
        </Panel>
      </div>

      <Panel className="report-panel">
        <fieldset className="report-fieldset">
          <legend>
            <span className="report-panel__question">How ready do you feel to begin?</span>
            <span className="fine-print">
              Voluntary self-report. Nothing is measured, compared, or stored.
            </span>
          </legend>
          <div className="report-scale" role="radiogroup" aria-label="Readiness self-report">
            {[1, 2, 3, 4, 5].map((value) => (
              <label
                key={value}
                className={`report-scale__item${
                  selfReport === value ? ' report-scale__item--selected' : ''
                }`}
              >
                <input
                  type="radio"
                  name="lumapause-self-report"
                  value={value}
                  checked={selfReport === value}
                  onChange={() => onSelfReport(value)}
                />
                <span className="report-scale__number numeric">{value}</span>
                <span className="report-scale__label">{selfReportLabel(value)}</span>
              </label>
            ))}
          </div>
          <p className="report-panel__answer" aria-live="polite">
            {selfReport ? selfReportLabel(selfReport) : 'Choose a point if you want to.'}
          </p>
        </fieldset>
      </Panel>

      <div className="actions-row">
        <Button variant="primary" onClick={onFinish} disabled={busy}>
          Finish and clear the session
        </Button>
        <Button variant="ghost" onClick={onAnother} disabled={busy}>
          Start another session
        </Button>
      </div>

      <p className="fine-print">
        Finishing stops any remaining sensor work, releases the camera, and clears metric samples,
        the intention, and the self-report from memory. LumaPause returns to the welcome screen
        without assuming camera permission.
      </p>
    </div>
  );
}
