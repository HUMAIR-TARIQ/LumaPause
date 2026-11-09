import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type CameraStatusCode = 'denied' | 'not_found' | 'in_use' | 'unsupported' | 'unknown';

export class CameraAccessError extends Error {
  readonly code: CameraStatusCode;
  readonly denied: boolean;
  readonly failure: CameraFailure;

  constructor(failure: CameraFailure) {
    super(failure.message);
    this.name = 'CameraAccessError';
    this.code = failure.code;
    this.denied = failure.code === 'denied';
    this.failure = failure;
  }
}

export interface CameraFailure {
  code: CameraStatusCode;
  title: string;
  message: string;
  action: string;
}

export interface CameraController {
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  status: 'idle' | 'requesting' | 'live' | 'denied' | 'error';
  failure: CameraFailure | null;
  request(deviceId?: string | null): Promise<MediaStream>;
  switchDevice(deviceId: string): Promise<MediaStream>;
  stop(): void;
}

function failureFor(code: CameraStatusCode): CameraFailure {
  switch (code) {
    case 'denied':
      return {
        code,
        title: 'Camera permission was not granted',
        message:
          'LumaPause needs camera frames to measure. Windows or the browser may be holding the permission.',
        action:
          'Allow camera access for LumaPause in Windows Settings, Privacy & security, Camera, then try again.',
      };
    case 'not_found':
      return {
        code,
        title: 'No camera was found',
        message: 'The system did not report an available video input device.',
        action: 'Connect a camera, close virtual-camera apps, and try again.',
      };
    case 'in_use':
      return {
        code,
        title: 'The camera is busy',
        message: 'Another application is already using the camera.',
        action: 'Close other camera applications, then try again.',
      };
    case 'unsupported':
      return {
        code,
        title: 'Camera capture is unavailable',
        message: 'This environment does not expose a camera capture API.',
        action: 'Use a supported desktop build, or explore demo mode.',
      };
    default:
      return {
        code,
        title: 'The camera could not start',
        message: 'The operating system did not return a usable camera stream.',
        action: 'Retry, choose another camera, or explore demo mode.',
      };
  }
}

function classifyError(error: unknown): CameraStatusCode {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'not_found';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'in_use';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

/**
 * Renderer-owned camera capture. The stream never leaves this process; only
 * downsampled RGBA frames are pushed through the preload frame port while a
 * session is explicitly running.
 */
export function useCamera(videoRef: RefObject<HTMLVideoElement | null>): CameraController {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<CameraController['status']>('idle');
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const release = useCallback((): void => {
    const current = streamRef.current;
    streamRef.current = null;
    if (current) {
      for (const track of current.getTracks()) track.stop();
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
  }, [videoRef]);

  const bind = useCallback(
    async (next: MediaStream): Promise<void> => {
      streamRef.current = next;
      setStream(next);
      const video = videoRef.current;
      if (video) {
        video.srcObject = next;
        try {
          await video.play();
        } catch {
          // Muted autoplay should succeed; frame delivery will retry on the
          // next video frame callback if the element was not ready yet.
        }
      }
    },
    [videoRef],
  );

  const request = useCallback(
    async (deviceId?: string | null): Promise<MediaStream> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        const mapped = failureFor('unsupported');
        setFailure(mapped);
        setStatus('error');
        throw new CameraAccessError(mapped);
      }

      release();
      setStatus('requesting');
      setFailure(null);

      try {
        // SmartSpectra rejects sustained capture below 25 fps. Chromium's
        // former 720p `ideal` request selected a low-frame-rate webcam mode on
        // this Windows hardware, even though its 640x480 mode supports 30 fps.
        const deviceConstraint = deviceId ? { deviceId: { exact: deviceId } } : {};
        const candidates: MediaTrackConstraints[] = [
          {
            width: { exact: 640 },
            height: { exact: 480 },
            frameRate: { min: 25, ideal: 30, max: 30 },
            ...deviceConstraint,
          },
          {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { min: 25, ideal: 30, max: 30 },
            ...deviceConstraint,
          },
          {
            frameRate: { min: 25, ideal: 30, max: 30 },
            ...deviceConstraint,
          },
        ];

        let media: MediaStream | null = null;
        let lastConstraintError: unknown = null;
        for (const video of candidates) {
          try {
            const candidate = await navigator.mediaDevices.getUserMedia({ video, audio: false });
            const reportedFps = candidate.getVideoTracks()[0]?.getSettings().frameRate;
            if (typeof reportedFps === 'number' && reportedFps < 25) {
              candidate.getTracks().forEach((track) => track.stop());
              lastConstraintError = new DOMException(
                `Camera selected ${reportedFps} fps; SmartSpectra requires at least 25 fps.`,
                'OverconstrainedError',
              );
              continue;
            }
            media = candidate;
            break;
          } catch (error) {
            lastConstraintError = error;
          }
        }
        if (!media) throw lastConstraintError ?? new Error('No 25 fps camera mode is available.');

        await bind(media);

        const track = media.getVideoTracks()[0] ?? null;
        const settings = track?.getSettings();
        setActiveDeviceId(settings?.deviceId ?? deviceId ?? null);

        try {
          const listed = await navigator.mediaDevices.enumerateDevices();
          setDevices(listed.filter((device) => device.kind === 'videoinput'));
        } catch {
          setDevices([]);
        }

        setStatus('live');
        return media;
      } catch (error) {
        const code = classifyError(error);
        const mapped = failureFor(code);
        setFailure(mapped);
        setStatus(code === 'denied' ? 'denied' : 'error');
        throw new CameraAccessError(mapped);
      }
    },
    [bind, release],
  );

  const switchDevice = useCallback(
    (deviceId: string): Promise<MediaStream> => request(deviceId),
    [request],
  );

  const stop = useCallback((): void => {
    release();
    setStatus('idle');
    setFailure(null);
  }, [release]);

  // Never leave a track running if the component that owns the session unmounts.
  useEffect(() => {
    return () => {
      release();
    };
  }, [release]);

  return {
    stream,
    devices,
    activeDeviceId,
    status,
    failure,
    request,
    switchDevice,
    stop,
  };
}
