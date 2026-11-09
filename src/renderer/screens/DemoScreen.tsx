import type { ReactNode } from 'react';
import type { SimulatorScenario } from '../../shared/contracts';
import { SCENARIOS, SCENARIO_ORDER } from '../../simulator/scenarios';
import { Button, Eyebrow, Panel, StatusChip, Toggle } from '../components/ui';

export function DemoScreen({
  scenario,
  expressionResponsive,
  busy,
  onScenario,
  onExpression,
  onStart,
  onBack,
}: {
  scenario: SimulatorScenario;
  expressionResponsive: boolean;
  busy: boolean;
  onScenario: (scenario: SimulatorScenario) => void;
  onExpression: (enabled: boolean) => void;
  onStart: () => void;
  onBack: () => void;
}): ReactNode {
  return (
    <div className="screen demo">
      <div className="screen-head">
        <div>
          <Eyebrow>Demo mode</Eyebrow>
          <h1 className="title">Choose a simulated scenario</h1>
        </div>
        <StatusChip tone="warn">Not SmartSpectra data</StatusChip>
      </div>
      <p className="lede lede--small">
        Demo mode runs the same visual pipeline with locally generated samples. It is for interface
        review when hardware is unavailable and is never evidence of live SDK integration.
      </p>

      <div className="scenario-grid" role="radiogroup" aria-label="Simulated scenario">
        {SCENARIO_ORDER.map((id) => {
          const profile = SCENARIOS[id];
          return (
            <label
              key={id}
              className={`scenario-card${scenario === id ? ' scenario-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="lumapause-scenario"
                value={id}
                checked={scenario === id}
                onChange={() => onScenario(id)}
              />
              <span className="scenario-card__title">{profile.label}</span>
              <span className="scenario-card__description">{profile.description}</span>
              <span className="scenario-card__demonstrates">
                Demonstrates: {profile.demonstrates}
              </span>
            </label>
          );
        })}
      </div>

      <Panel className="demo-panel">
        <Toggle
          checked={expressionResponsive}
          onChange={onExpression}
          label="Expression light"
          description="Synthetic expression probabilities can warm the palette. Turning it off removes that influence."
        />
        <p className="fine-print">
          Demo signals use the same confidence and stability checks as live data. A simulated sample
          that fails a threshold is treated as unavailable, not promoted to a reading.
        </p>
      </Panel>

      <div className="actions-row">
        <Button variant="primary" onClick={onStart} disabled={busy}>
          Enter demo room
        </Button>
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
      </div>
    </div>
  );
}
