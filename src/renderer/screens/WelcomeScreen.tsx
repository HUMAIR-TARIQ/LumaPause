import type { ReactNode } from 'react';
import { APP_TAGLINE } from '../../shared/constants';
import type { EnvironmentInfo } from '../../shared/contracts';
import { Button, Eyebrow, PrivacyLine, StatusChip } from '../components/ui';

export function WelcomeScreen({
  env,
  onBegin,
  onHowItWorks,
}: {
  env: EnvironmentInfo | null;
  onBegin: () => void;
  onHowItWorks: () => void;
}): ReactNode {
  return (
    <div className="screen welcome">
      <div className="welcome__ambient" aria-hidden="true" />
      <div className="welcome__content">
        <Eyebrow>A living light room</Eyebrow>
        <h1 className="display-title">
          Luma<span className="display-title__soft">Pause</span>
        </h1>
        <p className="lede">{APP_TAGLINE}</p>
        <div className="welcome__status">
          {env ? (
            env.platform === 'web' ? (
              <StatusChip tone="good">Online experience ready</StatusChip>
            ) : env.keyPresent && env.platformSupported && !env.nativeRuntimeError ? (
              <StatusChip tone="good">Live measurement ready on this device</StatusChip>
            ) : (
              <StatusChip tone="learning">Setup guidance available</StatusChip>
            )
          ) : (
            <StatusChip tone="neutral">Checking the local environment</StatusChip>
          )}
          <StatusChip tone="neutral">No video is recorded</StatusChip>
        </div>
        <div className="welcome__actions">
          <Button variant="primary" onClick={onBegin} disabled={!env}>
            Begin privately
          </Button>
          <Button variant="ghost" onClick={onHowItWorks}>
            How it works
          </Button>
        </div>
        <PrivacyLine />
        <div className="welcome__stages" aria-label="The experience">
          <div>
            <span className="welcome__stage-index">01</span>
            <span>Consent and signal check</span>
          </div>
          <div>
            <span className="welcome__stage-index">02</span>
            <span>A two-minute responsive room</span>
          </div>
          <div>
            <span className="welcome__stage-index">03</span>
            <span>Reflection, then everything clears</span>
          </div>
        </div>
      </div>
    </div>
  );
}
