import type { ReactNode } from 'react';
import type { EnvironmentInfo } from '../../shared/contracts';
import { Button, Eyebrow, Panel, StatusChip } from '../components/ui';

export function SetupScreen({
  env,
  envError,
  onDemo,
  onBack,
}: {
  env: EnvironmentInfo | null;
  envError: string | null;
  onDemo: () => void;
  onBack: () => void;
}): ReactNode {
  const missingKey = Boolean(env && !env.keyPresent);
  const unsupported = Boolean(env && !env.platformSupported);
  const runtimeIssue = env?.nativeRuntimeError ?? null;
  const isWeb = env?.platform === 'web';

  return (
    <div className="screen screen--narrow">
      <Eyebrow>{isWeb ? 'Online experience' : 'Local setup'}</Eyebrow>
      <h1 className="title">
        {isWeb ? 'The responsive room is ready online' : 'Live measurement needs a little setup'}
      </h1>
      <p className="lede lede--small">
        {isWeb
          ? 'Explore every stage with clearly labelled simulated signals. Real SmartSpectra camera measurement remains in the desktop application because it requires a native runtime.'
          : 'LumaPause reads the SmartSpectra API key only in the Electron main process. The key is never sent to this window, never logged, and never included in build output.'}
      </p>

      {envError ? (
        <Panel className="setup-panel">
          <StatusChip tone="danger">Bridge unavailable</StatusChip>
          <p>{envError}</p>
        </Panel>
      ) : null}

      {missingKey && !isWeb ? (
        <Panel className="setup-panel">
          <div className="setup-panel__head">
            <StatusChip tone="learning">No API key detected</StatusChip>
          </div>
          <p>
            Add your SmartSpectra key from{' '}
            <span className="mono-inline">physiology.presagetech.com</span> to the environment of
            the terminal that launches LumaPause, then restart the app.
          </p>
          <div className="code-block">
            <span className="code-block__label">PowerShell (current session)</span>
            <code>$env:SMARTSPECTRA_API_KEY="YOUR_KEY"; npm run dev</code>
          </div>
          <div className="code-block">
            <span className="code-block__label">Local development file</span>
            <code>SMARTSPECTRA_API_KEY=YOUR_KEY</code>
          </div>
          <p className="fine-print">
            Save that line in a file named <span className="mono-inline">.env</span> at the project
            root for local development only. <span className="mono-inline">.env*</span> is ignored
            by Git. A distributed build should use a reviewed credential or OAuth strategy, not an
            embedded developer key.
          </p>
        </Panel>
      ) : null}

      {unsupported && !isWeb ? (
        <Panel className="setup-panel">
          <StatusChip tone="danger">Unsupported platform</StatusChip>
          <p>
            SmartSpectra publishes native runtimes for Windows x64, macOS Apple Silicon, Linux x64,
            and Linux arm64. This build is running on {env?.platform}-{env?.arch}.
          </p>
        </Panel>
      ) : null}

      {runtimeIssue && !isWeb ? (
        <Panel className="setup-panel">
          <StatusChip tone="danger">Native runtime issue</StatusChip>
          <p>{runtimeIssue}</p>
          <p className="fine-print">
            Reinstall dependencies with <span className="mono-inline">npm install</span> and restart
            LumaPause.
          </p>
        </Panel>
      ) : null}

      {env ? (
        <dl className="env-grid">
          <div>
            <dt>Platform</dt>
            <dd>
              {env.platform}-{env.arch}
            </dd>
          </div>
          <div>
            <dt>SmartSpectra SDK</dt>
            <dd>{env.sdkVersion ?? 'not installed'}</dd>
          </div>
          <div>
            <dt>Key source</dt>
            <dd>{env.keySource === 'dotenv' ? 'local .env (development)' : env.keySource}</dd>
          </div>
          <div>
            <dt>Telemetry</dt>
            <dd>disabled in SDK options</dd>
          </div>
        </dl>
      ) : null}

      <div className="actions-row">
        <Button variant="primary" onClick={onDemo} disabled={!env}>
          {isWeb ? 'Enter online experience' : 'Explore demo mode'}
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
      <p className="fine-print">
        Demo mode is simulated. It cannot verify live SmartSpectra integration and stays labelled
        everywhere it appears.
      </p>
    </div>
  );
}
