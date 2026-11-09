import type { ReactNode } from 'react';
import { SIMULATION_DISCLOSURE } from '../../simulator/scenarios';

/**
 * Permanent disclosure for demo mode. It is rendered by the app shell for every
 * simulated phase, including reflection, so a screenshot can never present
 * synthetic signals as SmartSpectra output.
 */
export function SimulatedBanner(): ReactNode {
  return (
    <div className="sim-banner" role="note">
      <span className="sim-banner__mark" aria-hidden="true" />
      <span>{SIMULATION_DISCLOSURE}</span>
    </div>
  );
}
