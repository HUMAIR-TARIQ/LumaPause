import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionPhase } from '../shared/contracts';
import { DeveloperOverlay } from './components/DeveloperOverlay';
import { HowItWorksDialog } from './components/HowItWorksDialog';
import { SimulatedBanner } from './components/SimulatedBanner';
import { useSession } from './hooks/useSession';
import { CameraCheckScreen } from './screens/CameraCheckScreen';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { ConsentScreen } from './screens/ConsentScreen';
import { DemoScreen } from './screens/DemoScreen';
import { ErrorScreen } from './screens/ErrorScreen';
import { PartialSignalScreen } from './screens/PartialScreen';
import { PermissionScreen } from './screens/PermissionScreen';
import { ReadyScreen } from './screens/ReadyScreen';
import { ReflectionScreen } from './screens/ReflectionScreen';
import { RoomScreen } from './screens/RoomScreen';
import { SetupScreen } from './screens/SetupScreen';
import { StartupErrorScreen } from './screens/StartupErrorScreen';
import { TransitionScreen } from './screens/TransitionScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { Button } from './components/ui';

type ScreenKey =
  | 'welcome'
  | 'setup'
  | 'consent'
  | 'requesting'
  | 'camera'
  | 'calibrating'
  | 'ready'
  | 'partial'
  | 'demo'
  | 'room'
  | 'stopping'
  | 'reflection'
  | 'clearing'
  | 'permission'
  | 'error';

function screenKey(phase: SessionPhase): ScreenKey {
  switch (phase) {
    case 'welcome':
      return 'welcome';
    case 'setup_required':
      return 'setup';
    case 'consent':
      return 'consent';
    case 'requesting_camera':
      return 'requesting';
    case 'validating_input':
      return 'camera';
    case 'calibrating':
      return 'calibrating';
    case 'ready':
      return 'ready';
    case 'partial_signal_continue':
      return 'partial';
    case 'demo':
      return 'demo';
    case 'active.arrive':
    case 'active.settle':
    case 'active.choose':
      return 'room';
    case 'stopping':
      return 'stopping';
    case 'reflection':
      return 'reflection';
    case 'clearing':
      return 'clearing';
    case 'permission_denied':
      return 'permission';
    case 'recoverable_error':
    case 'fatal_error':
      return 'error';
  }
}

const ANNOUNCEMENTS: Partial<Record<SessionPhase, string>> = {
  requesting_camera: 'Requesting the camera.',
  validating_input: 'Camera on. Checking signal quality.',
  calibrating: 'Calibration started.',
  ready: 'Calibration complete. The room is ready.',
  partial_signal_continue: 'Calibration complete with partial signal.',
  'active.arrive': 'Entering the responsive room.',
  stopping: 'Stopping the session and releasing the camera.',
  reflection: 'Session stopped. Camera off. Reflection is ready.',
  clearing: 'Clearing the session from memory.',
  permission_denied: 'Camera permission was not granted.',
};

export function App(): ReactNode {
  const session = useSession();
  const { machine, env, envError, camera, actions, snapshot, processing } = session;
  const [howOpen, setHowOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const previousScreen = useRef<ScreenKey | null>(null);

  const key = screenKey(machine.phase);
  const simulated = machine.mode === 'simulated' && machine.phase !== 'welcome';

  // Move focus to the new screen heading, but never on movement changes inside
  // the room. This gives keyboard and screen-reader users a stable landmark.
  useEffect(() => {
    if (previousScreen.current === key) return;
    const isFirstScreen = previousScreen.current === null;
    previousScreen.current = key;
    if (!isFirstScreen) {
      // Screens are full-page flows; a previous screen may have been scrolled
      // to its actions. Start every new stage at the top.
      window.scrollTo({ top: 0, left: 0 });
    }
    const heading = mainRef.current?.querySelector('h1');
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [key]);

  if (envError) {
    return (
      <div className="app">
        <main ref={mainRef}>
          <StartupErrorScreen message={envError} />
        </main>
      </div>
    );
  }

  function renderScreen(): ReactNode {
    switch (machine.phase) {
      case 'welcome':
        return (
          <WelcomeScreen env={env} onBegin={actions.begin} onHowItWorks={() => setHowOpen(true)} />
        );
      case 'setup_required':
        return (
          <SetupScreen
            env={env}
            envError={null}
            onDemo={() => actions.openDemo('stable')}
            onBack={actions.backToWelcome}
          />
        );
      case 'consent':
        return (
          <ConsentScreen
            env={env}
            onEnable={actions.enableCamera}
            onDemo={() => actions.openDemo('stable')}
            onBack={actions.backToWelcome}
          />
        );
      case 'requesting_camera':
        return <TransitionScreen kind="requesting_camera" />;
      case 'validating_input':
        return (
          <CameraCheckScreen
            camera={camera}
            snapshot={snapshot}
            processing={processing}
            busy={session.busy}
            onContinue={actions.startCalibration}
            onExit={actions.backToWelcome}
            onRetryCamera={actions.retryCameraOnly}
            onSelectCamera={actions.selectCamera}
          />
        );
      case 'calibrating':
        return (
          <CalibrationScreen
            snapshot={snapshot}
            elapsedMs={session.calibrationElapsedMs}
            progress={session.calibrationProgress}
            timing={session.timing}
            offerPartial={session.offerPartial}
            busy={session.busy}
            expressionConsented={session.expressionConsented}
            simulated={machine.mode === 'simulated'}
            onComplete={actions.completeCalibration}
            onPartial={actions.acceptPartial}
            onStop={actions.stopRoom}
          />
        );
      case 'ready':
        return (
          <ReadyScreen
            snapshot={snapshot}
            simulated={machine.mode === 'simulated'}
            busy={session.busy}
            onEnter={actions.enterRoom}
            onStop={actions.stopRoom}
          />
        );
      case 'partial_signal_continue':
        return (
          <PartialSignalScreen
            snapshot={snapshot}
            busy={session.busy}
            onEnter={actions.enterRoom}
            onKeepCalibrating={actions.keepCalibrating}
            onStop={actions.stopRoom}
          />
        );
      case 'demo':
        return (
          <DemoScreen
            scenario={session.scenario}
            expressionResponsive={session.expressionResponsive}
            busy={session.busy}
            onScenario={actions.setScenario}
            onExpression={actions.setExpressionResponsive}
            onStart={actions.startDemoSession}
            onBack={actions.backToWelcome}
          />
        );
      case 'active.arrive':
      case 'active.settle':
      case 'active.choose':
        return (
          <RoomScreen
            phase={machine.phase}
            snapshot={snapshot}
            elapsedMs={session.roomElapsedMs}
            roomTotalMs={session.timing.roomTotalMs}
            busy={session.busy}
            simulated={machine.mode === 'simulated'}
            expressionConsented={session.expressionConsented}
            expressionResponsive={session.expressionResponsive}
            scenario={session.scenario}
            reducedMotion={session.reducedMotion}
            highContrast={session.highContrast}
            intention={session.intention}
            onIntention={actions.setIntention}
            onExpression={actions.setExpressionResponsive}
            onScenario={actions.setScenario}
            onToggleReducedMotion={actions.toggleReducedMotion}
            onToggleHighContrast={actions.toggleHighContrast}
            onStop={actions.stopRoom}
          />
        );
      case 'stopping':
        return <TransitionScreen kind="stopping" />;
      case 'reflection':
        return (
          <ReflectionScreen
            facts={session.facts}
            snapshot={snapshot}
            intention={session.intention}
            selfReport={session.selfReport}
            busy={session.busy}
            simulated={machine.mode === 'simulated'}
            onSelfReport={actions.setSelfReport}
            onFinish={actions.finishReflection}
            onAnother={actions.startAnother}
          />
        );
      case 'clearing':
        return <TransitionScreen kind="clearing" />;
      case 'permission_denied':
        return (
          <PermissionScreen
            failure={camera.failure}
            busy={session.busy}
            onRetry={actions.retry}
            onDemo={() => actions.openDemo('stable')}
            onBack={actions.backToWelcome}
          />
        );
      case 'recoverable_error':
      case 'fatal_error':
        return machine.error ? (
          <ErrorScreen
            error={machine.error}
            busy={session.busy}
            onRetry={actions.retry}
            onDemo={() => actions.openDemo(session.scenario)}
            onBack={actions.backToWelcome}
          />
        ) : (
          <TransitionScreen kind="stopping" />
        );
    }
  }

  return (
    <div
      className={`app${simulated ? ' app--simulated' : ''}${
        session.highContrast ? ' app--contrast' : ''
      }${session.reducedMotion ? ' app--reduce' : ''}`}
      data-phase={machine.phase}
      data-mode={machine.mode}
    >
      <video
        ref={session.pumpVideoRef}
        className="pump-video"
        muted
        playsInline
        aria-hidden="true"
      />

      <p className="sr-only" role="status" aria-live="polite">
        {ANNOUNCEMENTS[machine.phase] ?? ''}
      </p>

      {simulated ? <SimulatedBanner /> : null}

      <main ref={mainRef} className={`app__main app__main--${key}`}>
        {renderScreen()}
      </main>

      {session.devOverlay ? (
        <DeveloperOverlay
          snapshot={snapshot}
          processing={processing}
          phase={machine.phase}
          mode={machine.mode}
          env={env}
          onClose={actions.toggleDevOverlay}
        />
      ) : null}

      <HowItWorksDialog open={howOpen} onClose={() => setHowOpen(false)} />

      {session.clearedNotice ? (
        <div className="cleared-toast" role="status">
          <span className="cleared-toast__mark" aria-hidden="true" />
          <span>Session cleared from memory</span>
          <Button variant="quiet" onClick={actions.dismissClearedNotice}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
