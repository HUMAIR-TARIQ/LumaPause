import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CALIBRATION_PARTIAL_OFFER_MS,
  MIN_CALIBRATION_MS,
  MOVEMENT_DURATIONS_MS,
  ROOM_TOTAL_MS,
} from '../../shared/constants';
import type {
  ApiResult,
  ConsentRecord,
  EnvironmentInfo,
  ProcessingState,
  SessionErrorInfo,
  SessionFacts,
  SignalSnapshot,
  SimulatorScenario,
} from '../../shared/contracts';
import {
  INITIAL_STATE,
  canStop,
  isActivePhase,
  transition,
  type MachineEvent,
  type MachineState,
} from '../../shared/state-machine';
import { FramePump } from '../camera/frame-pump';
import {
  CameraAccessError,
  useCamera,
  type CameraController,
  type CameraFailure,
} from '../camera/useCamera';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface SessionTiming {
  scale: number;
  minCalibrationMs: number;
  partialOfferMs: number;
  arriveMs: number;
  settleMs: number;
  chooseMs: number;
  roomTotalMs: number;
}

export interface SessionActions {
  begin(): void;
  openDemo(scenario?: SimulatorScenario): void;
  enableCamera(expression: boolean): void;
  startCalibration(): void;
  completeCalibration(): void;
  acceptPartial(): void;
  keepCalibrating(): void;
  enterRoom(): void;
  stopRoom(): void;
  startDemoSession(): void;
  retry(): void;
  retryCameraOnly(): void;
  selectCamera(deviceId: string): void;
  backToWelcome(): void;
  finishReflection(): void;
  startAnother(): void;
  setIntention(value: string): void;
  setSelfReport(value: number | null): void;
  setScenario(scenario: SimulatorScenario): void;
  setExpressionResponsive(enabled: boolean): void;
  toggleReducedMotion(): void;
  toggleHighContrast(): void;
  toggleDevOverlay(): void;
  dismissClearedNotice(): void;
}

export interface SessionController {
  machine: MachineState;
  env: EnvironmentInfo | null;
  envError: string | null;
  snapshot: SignalSnapshot | null;
  processing: ProcessingState | null;
  facts: SessionFacts | null;
  busy: boolean;
  camera: CameraController;
  pumpVideoRef: RefObject<HTMLVideoElement | null>;
  intention: string;
  selfReport: number | null;
  clearedNotice: boolean;
  expressionResponsive: boolean;
  expressionConsented: boolean;
  scenario: SimulatorScenario;
  reducedMotion: boolean;
  highContrast: boolean;
  devOverlay: boolean;
  roomElapsedMs: number;
  calibrationElapsedMs: number;
  calibrationProgress: number;
  offerPartial: boolean;
  timing: SessionTiming;
  actions: SessionActions;
}

const CAMERA_STAGE_PHASES = new Set([
  'validating_input',
  'calibrating',
  'ready',
  'partial_signal_continue',
]);

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function unexpectedError(error: unknown): SessionErrorInfo {
  return {
    code: 'RENDERER_ERROR',
    kind: 'recoverable',
    title: 'Something interrupted the session',
    message: error instanceof Error ? error.message : String(error),
    action: 'Retry, or explore demo mode while the issue is investigated.',
    retryable: true,
    sdkCode: null,
    at: Date.now(),
  };
}

function cameraErrorInfo(failure: CameraFailure): SessionErrorInfo {
  return {
    code: `CAMERA_${failure.code.toUpperCase()}`,
    kind: 'recoverable',
    title: failure.title,
    message: failure.message,
    action: failure.action,
    retryable: true,
    sdkCode: null,
    at: Date.now(),
  };
}

/**
 * React-side session orchestrator.
 *
 * The FSM is the source of truth for navigation; the main process is the source
 * of truth for sensor state. The controller coordinates camera capture, the
 * preload bridge, and timed movements without ever receiving the API key.
 */
export function useSession(): SessionController {
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [machine, setMachine] = useState<MachineState>(INITIAL_STATE);
  const [snapshot, setSnapshot] = useState<SignalSnapshot | null>(null);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [facts, setFacts] = useState<SessionFacts | null>(null);
  const [busy, setBusy] = useState(false);
  const [intention, setIntention] = useState('');
  const [selfReport, setSelfReport] = useState<number | null>(null);
  const [clearedNotice, setClearedNotice] = useState(false);
  const [expressionResponsive, setExpressionResponsiveState] = useState(true);
  const [expressionConsented, setExpressionConsented] = useState(true);
  const [scenario, setScenarioState] = useState<SimulatorScenario>('stable');
  const [reducedMotionOverride, setReducedMotionOverride] = useState<boolean | null>(null);
  const [highContrast, setHighContrast] = useState(false);
  const [devOverlay, setDevOverlay] = useState(false);
  const [calibrationElapsedMs, setCalibrationElapsedMs] = useState(0);
  const [roomElapsedMs, setRoomElapsedMs] = useState(0);

  const machineRef = useRef<MachineState>(INITIAL_STATE);
  const envRef = useRef<EnvironmentInfo | null>(null);
  const busyRef = useRef(false);
  const snapshotRef = useRef<SignalSnapshot | null>(null);
  const expressionResponsiveRef = useRef(true);
  const scenarioRef = useRef<SimulatorScenario>('stable');
  const calibrationStartRef = useRef<number | null>(null);
  const calibrationElapsedRef = useRef(0);
  const roomStartRef = useRef<number | null>(null);
  const roomElapsedRef = useRef(0);
  const chooseEnteredAtRef = useRef<number | null>(null);
  const pumpRef = useRef<FramePump | null>(null);
  const pumpVideoRef = useRef<HTMLVideoElement | null>(null);
  const systemReducedMotion = usePrefersReducedMotion();

  const camera = useCamera(pumpVideoRef);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const stopCameraRef = useRef(camera.stop);
  stopCameraRef.current = camera.stop;

  useEffect(() => {
    envRef.current = env;
  }, [env]);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  useEffect(() => {
    expressionResponsiveRef.current = expressionResponsive;
  }, [expressionResponsive]);
  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  const timing = useMemo<SessionTiming>(() => {
    const scale = env?.timingScale ?? 1;
    return {
      scale,
      minCalibrationMs: MIN_CALIBRATION_MS * scale,
      partialOfferMs: CALIBRATION_PARTIAL_OFFER_MS * scale,
      arriveMs: MOVEMENT_DURATIONS_MS.arrive * scale,
      settleMs: MOVEMENT_DURATIONS_MS.settle * scale,
      chooseMs: MOVEMENT_DURATIONS_MS.choose * scale,
      roomTotalMs: ROOM_TOTAL_MS * scale,
    };
  }, [env]);
  const timingRef = useRef(timing);
  timingRef.current = timing;

  const effectiveReducedMotion = reducedMotionOverride ?? systemReducedMotion;

  const dispatch = useCallback((event: MachineEvent): boolean => {
    const result = transition(machineRef.current, event);
    if (result.rejected) {
      if (import.meta.env.DEV) {
        console.warn(`[LumaPause] rejected ${event.type}: ${result.reason ?? 'unknown'}`);
      }
      return false;
    }
    machineRef.current = result.state;
    setMachine(result.state);
    return true;
  }, []);

  const updateBusy = useCallback((value: boolean): void => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const clearLocalSession = useCallback((): void => {
    setSnapshot(null);
    setProcessing(null);
    setFacts(null);
    setIntention('');
    setSelfReport(null);
    setCalibrationElapsedMs(0);
    setRoomElapsedMs(0);
    calibrationElapsedRef.current = 0;
    roomElapsedRef.current = 0;
    calibrationStartRef.current = null;
    roomStartRef.current = null;
    snapshotRef.current = null;
  }, []);

  const fail = useCallback(
    (info: SessionErrorInfo): void => {
      stopCameraRef.current();
      dispatch({ type: 'error', error: info });
    },
    [dispatch],
  );

  const handleCameraError = useCallback(
    (error: unknown): void => {
      if (error instanceof CameraAccessError) {
        if (error.denied && machineRef.current.phase === 'requesting_camera') {
          dispatch({ type: 'camera-denied' });
          return;
        }
        fail(cameraErrorInfo(error.failure));
        return;
      }
      fail(unexpectedError(error));
    },
    [dispatch, fail],
  );

  useEffect(() => {
    let cancelled = false;
    const bridge = typeof window === 'undefined' ? undefined : window.lumapause;
    if (!bridge) {
      setEnvError(
        'The secure preload bridge is unavailable. Restart LumaPause; if the problem persists, reinstall the application.',
      );
      return;
    }
    bridge
      .getEnvironment()
      .then((value) => {
        if (!cancelled) setEnv(value);
      })
      .catch((error: unknown) => {
        if (!cancelled) setEnvError(unexpectedError(error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleIncomingError = useCallback(
    (info: SessionErrorInfo): void => {
      const phase = machineRef.current.phase;
      const canShow =
        phase === 'requesting_camera' ||
        phase === 'validating_input' ||
        phase === 'calibrating' ||
        phase === 'ready' ||
        phase === 'partial_signal_continue' ||
        phase === 'demo' ||
        isActivePhase(phase);
      if (!canShow) return;
      stopCameraRef.current();
      dispatch({ type: 'error', error: info });
    },
    [dispatch],
  );

  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.lumapause;
    if (!bridge) return;
    return bridge.onEvent((event) => {
      if (event.type === 'snapshot') {
        snapshotRef.current = event.snapshot;
        setSnapshot(event.snapshot);
      } else if (event.type === 'processing') {
        setProcessing(event.processing);
      } else if (event.type === 'session-facts') {
        setFacts(event.facts);
      } else if (event.type === 'error') {
        handleIncomingError(event.error);
      }
    });
  }, [handleIncomingError]);

  // Calibration timer. Elapsed time is measured from the start of calibration,
  // not from SDK start, and is accelerated only by the explicit test timing scale.
  useEffect(() => {
    if (machine.phase !== 'calibrating') return;
    if (calibrationStartRef.current === null) {
      calibrationStartRef.current = performance.now();
    }
    const start = calibrationStartRef.current;
    const tick = (): void => {
      const elapsed = performance.now() - start;
      calibrationElapsedRef.current = elapsed;
      setCalibrationElapsedMs(elapsed);
    };
    tick();
    const interval = window.setInterval(tick, 200);
    return () => window.clearInterval(interval);
  }, [machine.phase]);

  const stopRoom = useCallback((): void => {
    const phase = machineRef.current.phase;
    // Stop is offered from calibration, ready, partial and the room, but demo
    // setup owns a different transition (stop there would skip the running SDK).
    if (phase === 'demo' || !canStop(phase) || busyRef.current) return;
    const bridge = window.lumapause;
    updateBusy(true);
    if (!dispatch({ type: 'stop' })) {
      updateBusy(false);
      return;
    }
    // Release the camera immediately; the SDK drains its final frames.
    stopCameraRef.current();
    void bridge
      .stopSession()
      .then((result: ApiResult<SessionFacts>) => {
        if (result.ok) setFacts(result.value);
      })
      .catch(() => undefined)
      .finally(() => {
        dispatch({ type: 'stopped' });
        updateBusy(false);
      });
  }, [dispatch, updateBusy]);

  // Room clock and movement progression.
  useEffect(() => {
    if (!isActivePhase(machine.phase)) {
      setRoomElapsedMs(0);
      roomElapsedRef.current = 0;
      chooseEnteredAtRef.current = null;
      return;
    }
    // A stalled timer must not skip the Choose movement. Record when Choose
    // becomes visible and give it its intended dwell before auto-finishing.
    if (machine.phase === 'active.choose' && chooseEnteredAtRef.current === null) {
      chooseEnteredAtRef.current = performance.now();
    }
    const tick = (): void => {
      const start = roomStartRef.current;
      const adapterElapsed = snapshotRef.current?.roomElapsedMs ?? 0;
      const elapsed =
        adapterElapsed > 0 ? adapterElapsed : start === null ? 0 : performance.now() - start;
      roomElapsedRef.current = elapsed;
      setRoomElapsedMs(elapsed);

      const phase = machineRef.current.phase;
      const durations = timingRef.current;
      if (phase === 'active.arrive' && elapsed >= durations.arriveMs) {
        dispatch({ type: 'advance' });
      } else if (phase === 'active.settle' && elapsed >= durations.arriveMs + durations.settleMs) {
        dispatch({ type: 'advance' });
      } else if (phase === 'active.choose' && elapsed >= durations.roomTotalMs) {
        const enteredAt = chooseEnteredAtRef.current;
        if (enteredAt !== null && performance.now() - enteredAt >= durations.chooseMs) {
          stopRoom();
        }
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [machine.phase, dispatch, stopRoom]);

  const shouldPump =
    machine.mode === 'live' &&
    camera.stream !== null &&
    (CAMERA_STAGE_PHASES.has(machine.phase) || isActivePhase(machine.phase));

  // Frame pump lifecycle. One pump exists for the connected stream; it stops the
  // moment the room ends or the session leaves a measuring phase.
  useEffect(() => {
    if (!shouldPump) {
      pumpRef.current?.stop();
      pumpRef.current = null;
      return;
    }
    const video = pumpVideoRef.current;
    if (!video) return;
    if (pumpRef.current?.active) return;
    const bridge = window.lumapause;
    bridge.attachFramePort();
    const pump = new FramePump({
      onFrame: (header, buffer) => bridge.sendFrame(header, buffer),
      onError: (message) => console.warn(`[LumaPause] frame pump: ${message}`),
    });
    pumpRef.current = pump;
    pump.start(video);
  }, [shouldPump, camera.stream]);

  useEffect(() => {
    return () => {
      pumpRef.current?.stop();
      pumpRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!clearedNotice) return;
    const timeout = window.setTimeout(() => setClearedNotice(false), 6500);
    return () => window.clearTimeout(timeout);
  }, [clearedNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDevOverlay((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startLiveMeasurement = useCallback(
    async (consent: ConsentRecord): Promise<void> => {
      const bridge = window.lumapause;
      updateBusy(true);
      setFacts(null);
      setSnapshot(null);
      setSelfReport(null);
      setIntention('');
      calibrationStartRef.current = null;
      calibrationElapsedRef.current = 0;
      setCalibrationElapsedMs(0);

      try {
        if (!cameraRef.current.stream) {
          await cameraRef.current.request(cameraRef.current.activeDeviceId);
        }
        dispatch({ type: 'camera-granted' });

        const prepared = await bridge.prepareSession({
          consent,
          mode: 'live',
          expressionResponsiveness: consent.expression,
        });
        if (!prepared.ok) {
          fail(prepared.error);
          return;
        }

        const started = await bridge.startSession();
        if (!started.ok) {
          fail(started.error);
          return;
        }

        setExpressionConsented(consent.expression);
        setExpressionResponsiveState(consent.expression);
        bridge.attachFramePort();
      } catch (error) {
        handleCameraError(error);
      } finally {
        updateBusy(false);
      }
    },
    [dispatch, fail, handleCameraError, updateBusy],
  );

  const begin = useCallback((): void => {
    const environment = envRef.current;
    if (!environment) return;
    const canGoLive =
      environment.keyPresent &&
      environment.platformSupported &&
      environment.nativeRuntimeError === null;
    dispatch({ type: 'begin', keyPresent: canGoLive });
  }, [dispatch]);

  const openDemo = useCallback(
    (nextScenario: SimulatorScenario = 'stable'): void => {
      setScenarioState(nextScenario);
      scenarioRef.current = nextScenario;
      setExpressionConsented(true);
      dispatch({ type: 'start-demo', scenario: nextScenario });
    },
    [dispatch],
  );

  const enableCamera = useCallback(
    (expression: boolean): void => {
      const environment = envRef.current;
      if (!environment || machineRef.current.phase !== 'consent') return;
      const consent: ConsentRecord = {
        granted: true,
        version: environment.consentVersion,
        at: Date.now(),
        camera: true,
        expression,
        simulator: false,
      };
      setExpressionConsented(expression);
      setExpressionResponsiveState(expression);
      if (!dispatch({ type: 'enable-camera', consent })) return;
      void startLiveMeasurement(consent);
    },
    [dispatch, startLiveMeasurement],
  );

  const startCalibration = useCallback((): void => {
    dispatch({ type: 'start-calibration' });
  }, [dispatch]);

  const completeCalibration = useCallback((): void => {
    if (machineRef.current.phase !== 'calibrating') return;
    if (calibrationElapsedRef.current < timingRef.current.minCalibrationMs) return;
    dispatch({ type: 'calibration-complete', partial: false });
  }, [dispatch]);

  const acceptPartial = useCallback((): void => {
    if (machineRef.current.phase !== 'calibrating') return;
    if (calibrationElapsedRef.current < timingRef.current.minCalibrationMs) return;
    dispatch({ type: 'calibration-complete', partial: true });
  }, [dispatch]);

  const keepCalibrating = useCallback((): void => {
    dispatch({ type: 'keep-calibrating' });
  }, [dispatch]);

  const beginRoom = useCallback((): void => {
    roomStartRef.current = performance.now();
    roomElapsedRef.current = 0;
    setRoomElapsedMs(0);
    setIntention('');
    void window.lumapause.markRoomStart().catch(() => undefined);
  }, []);

  const enterRoom = useCallback((): void => {
    const phase = machineRef.current.phase;
    if (phase === 'ready') {
      if (dispatch({ type: 'enter-room' })) beginRoom();
    } else if (phase === 'partial_signal_continue') {
      if (dispatch({ type: 'enter-partial' })) beginRoom();
    }
  }, [beginRoom, dispatch]);

  const startDemoSession = useCallback((): void => {
    const phase = machineRef.current.phase;
    if (phase !== 'demo' || busyRef.current) return;
    updateBusy(true);
    window.lumapause
      .startDemo(scenarioRef.current, expressionResponsiveRef.current)
      .then((result) => {
        if (!result.ok) {
          fail(result.error);
          return;
        }
        setExpressionConsented(true);
        calibrationStartRef.current = null;
        dispatch({ type: 'demo-ready' });
      })
      .catch((error: unknown) => fail(unexpectedError(error)))
      .finally(() => updateBusy(false));
  }, [dispatch, fail, updateBusy]);

  const retry = useCallback((): void => {
    const phase = machineRef.current.phase;
    if (phase !== 'recoverable_error' && phase !== 'permission_denied') return;
    const consent = machineRef.current.consent;
    if (!dispatch({ type: 'retry' })) return;
    const next = machineRef.current.phase;
    if (next === 'demo' || next === 'consent' || !consent || next === 'setup_required') return;
    void startLiveMeasurement(consent);
  }, [dispatch, startLiveMeasurement]);

  const retryCameraOnly = useCallback((): void => {
    if (busyRef.current) return;
    updateBusy(true);
    cameraRef.current
      .request(cameraRef.current.activeDeviceId)
      .catch((error: unknown) => handleCameraError(error))
      .finally(() => updateBusy(false));
  }, [handleCameraError, updateBusy]);

  const selectCamera = useCallback(
    (deviceId: string): void => {
      if (busyRef.current) return;
      updateBusy(true);
      cameraRef.current
        .switchDevice(deviceId)
        .catch((error: unknown) => handleCameraError(error))
        .finally(() => updateBusy(false));
    },
    [handleCameraError, updateBusy],
  );

  const backToWelcome = useCallback((): void => {
    const phase = machineRef.current.phase;
    const canLeave =
      phase === 'setup_required' ||
      phase === 'permission_denied' ||
      phase === 'recoverable_error' ||
      phase === 'fatal_error' ||
      phase === 'consent' ||
      phase === 'demo' ||
      phase === 'validating_input' ||
      phase === 'calibrating' ||
      phase === 'ready' ||
      phase === 'partial_signal_continue';
    if (!canLeave || busyRef.current) return;

    updateBusy(true);
    stopCameraRef.current();
    const bridge = window.lumapause;
    bridge
      .stopSession()
      .catch(() => undefined)
      .then(() => bridge.finishSession())
      .catch(() => undefined)
      .finally(() => {
        clearLocalSession();
        dispatch({ type: 'back-welcome' });
        updateBusy(false);
      });
  }, [clearLocalSession, dispatch, updateBusy]);

  const finishReflection = useCallback((): void => {
    if (machineRef.current.phase !== 'reflection' || busyRef.current) return;
    updateBusy(true);
    if (!dispatch({ type: 'finish' })) {
      updateBusy(false);
      return;
    }
    const bridge = window.lumapause;
    bridge
      .finishSession()
      .catch(() => undefined)
      .finally(() => {
        clearLocalSession();
        dispatch({ type: 'cleared' });
        setClearedNotice(true);
        updateBusy(false);
      });
  }, [clearLocalSession, dispatch, updateBusy]);

  const startAnother = useCallback((): void => {
    if (machineRef.current.phase !== 'reflection' || busyRef.current) return;
    updateBusy(true);
    if (!dispatch({ type: 'start-another' })) {
      updateBusy(false);
      return;
    }
    const bridge = window.lumapause;
    bridge
      .finishSession()
      .catch(() => undefined)
      .finally(() => {
        clearLocalSession();
        dispatch({ type: 'cleared' });
        setExpressionResponsiveState(true);
        updateBusy(false);
      });
  }, [clearLocalSession, dispatch, updateBusy]);

  const updateExpression = useCallback(
    (enabled: boolean): void => {
      if (machineRef.current.mode === 'live' && !expressionConsented) return;
      setExpressionResponsiveState(enabled);
      expressionResponsiveRef.current = enabled;
      const phase = machineRef.current.phase;
      if (CAMERA_STAGE_PHASES.has(phase) || isActivePhase(phase)) {
        void window.lumapause.setExpressionResponsiveness(enabled).catch(() => undefined);
      }
    },
    [expressionConsented],
  );

  const updateScenario = useCallback((next: SimulatorScenario): void => {
    setScenarioState(next);
    scenarioRef.current = next;
    if (
      machineRef.current.mode === 'simulated' &&
      (isActivePhase(machineRef.current.phase) || CAMERA_STAGE_PHASES.has(machineRef.current.phase))
    ) {
      void window.lumapause.setScenario(next).catch(() => undefined);
    }
  }, []);

  const actions: SessionActions = {
    begin,
    openDemo,
    enableCamera,
    startCalibration,
    completeCalibration,
    acceptPartial,
    keepCalibrating,
    enterRoom,
    stopRoom,
    startDemoSession,
    retry,
    retryCameraOnly,
    selectCamera,
    backToWelcome,
    finishReflection,
    startAnother,
    setIntention: (value: string) => setIntention(value.slice(0, 140)),
    setSelfReport,
    setScenario: updateScenario,
    setExpressionResponsive: updateExpression,
    toggleReducedMotion: () => setReducedMotionOverride((value) => !(value ?? systemReducedMotion)),
    toggleHighContrast: () => setHighContrast((value) => !value),
    toggleDevOverlay: () => setDevOverlay((value) => !value),
    dismissClearedNotice: () => setClearedNotice(false),
  };

  return {
    machine,
    env,
    envError,
    snapshot,
    processing,
    facts,
    busy,
    camera,
    pumpVideoRef,
    intention,
    selfReport,
    clearedNotice,
    expressionResponsive,
    expressionConsented,
    scenario,
    reducedMotion: effectiveReducedMotion,
    highContrast,
    devOverlay,
    roomElapsedMs,
    calibrationElapsedMs,
    calibrationProgress: clamp01(
      timing.minCalibrationMs > 0 ? calibrationElapsedMs / timing.minCalibrationMs : 0,
    ),
    offerPartial: calibrationElapsedMs >= timing.partialOfferMs,
    timing,
    actions,
  };
}
