import { useState, type ReactNode } from 'react';
import {
  EXPRESSION_CONFIDENCE_THRESHOLD,
  PRIVACY_HEADLINE,
  SCENARIO_LABELS,
} from '../../shared/constants';
import type { SessionPhase, SignalSnapshot, SimulatorScenario } from '../../shared/contracts';
import { usableBreathing, usablePulse } from '../../shared/visual-mapping';
import { SCENARIO_ORDER } from '../../simulator/scenarios';
import { OrbCanvas } from '../components/OrbCanvas';
import { Button, StatusChip, Toggle } from '../components/ui';
import {
  availabilityText,
  formatDuration,
  movementCopy,
  movementFromPhase,
  movementIndex,
  type Movement,
} from '../lib/format';

const MOVEMENTS: Movement[] = ['arrive', 'settle', 'choose'];

function sampleText(
  sample: { value: number; confidence: number } | null,
  usable: boolean,
  unit: string,
  digits = 0,
): string {
  if (!sample || !usable) return 'No stable sample';
  const value = digits > 0 ? sample.value.toFixed(digits) : Math.round(sample.value).toString();
  return `${value} ${unit} · confidence ${Math.round(sample.confidence)}`;
}

export function RoomScreen({
  phase,
  snapshot,
  elapsedMs,
  roomTotalMs,
  busy,
  simulated,
  expressionConsented,
  expressionResponsive,
  scenario,
  reducedMotion,
  highContrast,
  intention,
  onIntention,
  onExpression,
  onScenario,
  onToggleReducedMotion,
  onToggleHighContrast,
  onStop,
}: {
  phase: SessionPhase;
  snapshot: SignalSnapshot | null;
  elapsedMs: number;
  roomTotalMs: number;
  busy: boolean;
  simulated: boolean;
  expressionConsented: boolean;
  expressionResponsive: boolean;
  scenario: SimulatorScenario;
  reducedMotion: boolean;
  highContrast: boolean;
  intention: string;
  onIntention: (value: string) => void;
  onExpression: (enabled: boolean) => void;
  onScenario: (scenario: SimulatorScenario) => void;
  onToggleReducedMotion: () => void;
  onToggleHighContrast: () => void;
  onStop: () => void;
}): ReactNode {
  const [signalsOpen, setSignalsOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  const movement = movementFromPhase(phase) ?? 'arrive';
  const copy = movementCopy(movement);
  const index = movementIndex(movement);
  const remaining = Math.max(0, roomTotalMs - elapsedMs);
  const visual = snapshot?.visual;
  const measuredBreathing = Boolean(visual?.measuredBreathing);
  const now = Date.now();
  const pulseUsable = usablePulse(snapshot?.pulse ?? null, now);
  const breathingUsable = usableBreathing(snapshot?.breathingRate ?? null, now);
  const expressionResponding =
    expressionConsented &&
    expressionResponsive &&
    Boolean(snapshot?.expression?.stable) &&
    Number(snapshot?.expression?.dominantConfidence ?? 0) >= EXPRESSION_CONFIDENCE_THRESHOLD;

  return (
    <div className="room">
      <OrbCanvas snapshot={snapshot} reducedMotion={reducedMotion} highContrast={highContrast} />

      <div className="room__hud">
        <header className="room__top">
          <span className="room__brand">LumaPause</span>
          <div className="room__meta">
            <StatusChip tone={visual?.signalAvailability === 'ready' ? 'good' : 'learning'}>
              {availabilityText(visual?.signalAvailability ?? 'none', simulated)}
            </StatusChip>
            <StatusChip tone={simulated ? 'warn' : 'neutral'}>
              {simulated ? 'Simulated · camera off' : 'Camera on · processed locally'}
            </StatusChip>
          </div>
          <span className="room__timer numeric" aria-hidden="true">
            {formatDuration(remaining)}
          </span>
        </header>

        <div className="room__center">
          <ol className="movement-track" aria-label="Room movements">
            {MOVEMENTS.map((step, stepIndex) => (
              <li
                key={step}
                className={`movement-track__step${
                  stepIndex === index ? ' movement-track__step--current' : ''
                }${stepIndex < index ? ' movement-track__step--done' : ''}`}
              >
                <span className="movement-track__dot" aria-hidden="true" />
                <span>{movementCopy(step).title}</span>
              </li>
            ))}
          </ol>

          <div className="room__copy" aria-live="polite">
            <h1 className="room__title">{copy.title}</h1>
            <p className="room__instruction">{copy.instruction}</p>
          </div>

          {movement === 'settle' ? (
            <p className="room__cue">
              {measuredBreathing
                ? simulated
                  ? 'The orb is following a simulated breathing rhythm. This is not SmartSpectra data.'
                  : 'The orb is following a measured breathing rhythm. Follow it only if it feels comfortable.'
                : simulated
                  ? 'The orb is moving in a slow ambient rhythm. No simulated breathing signal is active right now.'
                  : 'The orb is moving in a slow ambient rhythm. No breathing signal is being measured right now.'}
            </p>
          ) : null}

          {movement === 'choose' ? (
            <form
              className="room__choose"
              onSubmit={(event) => {
                event.preventDefault();
                onStop();
              }}
            >
              <label className="field field--room">
                <span>One small intention for what comes next</span>
                <textarea
                  value={intention}
                  onChange={(event) => onIntention(event.target.value)}
                  rows={2}
                  maxLength={140}
                  placeholder="For example: speak slowly and look up between points."
                />
              </label>
              <div className="room__choose-row">
                <span className="fine-print numeric">
                  {intention.length}/140 · kept in memory only
                </span>
                <Button variant="secondary" onClick={() => onStop()} disabled={busy}>
                  Complete the room
                </Button>
              </div>
            </form>
          ) : null}
        </div>

        <footer className="room__bottom">
          <div className="room__actions">
            <Button variant="secondary" className="room__stop" onClick={onStop} disabled={busy}>
              Stop and see reflection
            </Button>
            <span className="room__privacy">{PRIVACY_HEADLINE}</span>
          </div>

          <div className="room__drawers">
            <div className="room-drawer">
              <button
                type="button"
                className="room-drawer__summary"
                aria-expanded={signalsOpen}
                onClick={() => setSignalsOpen((open) => !open)}
              >
                {signalsOpen ? 'Hide live signals' : 'Show live signals'}
              </button>
              {signalsOpen ? (
                <div className="room-drawer__body">
                  <dl className="room-signals">
                    <div>
                      <dt>Pulse</dt>
                      <dd className="numeric">
                        {sampleText(snapshot?.pulse ?? null, pulseUsable, 'bpm')}
                      </dd>
                    </div>
                    <div>
                      <dt>Breathing</dt>
                      <dd className="numeric">
                        {sampleText(snapshot?.breathingRate ?? null, breathingUsable, 'br/min', 1)}
                      </dd>
                    </div>
                    <div>
                      <dt>Breathing trace</dt>
                      <dd className="numeric">
                        {measuredBreathing && snapshot?.upperBreathingWaveform
                          ? `relative position ${(
                              snapshot.upperBreathingWaveform.normalized ?? 0.5
                            ).toFixed(2)}`
                          : 'Ambient animation, not measured'}
                      </dd>
                    </div>
                    <div>
                      <dt>Expression light</dt>
                      <dd>
                        {!expressionConsented
                          ? 'Not enabled in consent'
                          : !expressionResponsive
                            ? 'Turned off in this room'
                            : expressionResponding
                              ? 'Responding to visible expression patterns'
                              : 'Not enough confidence to respond'}
                      </dd>
                    </div>
                  </dl>
                  <p className="fine-print">
                    {simulated
                      ? 'These values are simulated for interface review. They are not SmartSpectra measurements. '
                      : 'Values appear only while a fresh, stable sample exists. '}
                    The room never treats a missing signal as a reading and never labels a value as
                    good, bad, calm, or stressed.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="room-drawer">
              <button
                type="button"
                className="room-drawer__summary"
                aria-expanded={controlsOpen}
                onClick={() => setControlsOpen((open) => !open)}
              >
                {controlsOpen ? 'Hide room controls' : 'Room controls'}
              </button>
              {controlsOpen ? (
                <div className="room-drawer__body room-controls">
                  <Toggle
                    checked={reducedMotion}
                    onChange={onToggleReducedMotion}
                    label="Reduce visual motion"
                    description="Keeps colour and scale changes; removes particles and drifting movement."
                  />
                  <Toggle
                    checked={highContrast}
                    onChange={onToggleHighContrast}
                    label="High contrast"
                    description="Strengthens text, borders, and the light field."
                  />
                  <Toggle
                    checked={expressionResponsive && expressionConsented}
                    onChange={onExpression}
                    label="Expression light"
                    description={
                      expressionConsented
                        ? 'A subtle palette warmth from high-confidence expression patterns.'
                        : 'Facial-expression probabilities were not enabled in consent.'
                    }
                    disabled={!expressionConsented}
                  />
                  {simulated ? (
                    <label className="field field--room">
                      <span>Simulated scenario</span>
                      <select
                        value={scenario}
                        onChange={(event) => onScenario(event.target.value as SimulatorScenario)}
                      >
                        {SCENARIO_ORDER.map((id) => (
                          <option key={id} value={id}>
                            {SCENARIO_LABELS[id]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
