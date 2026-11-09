import { CAPTURE_FPS, CAPTURE_HEIGHT, CAPTURE_WIDTH } from '../../shared/constants';
import type { FramePacketHeader } from '../../shared/contracts';
import { FrameClock } from './frame-clock';
import type { FrameWorkerResponse } from './frame-worker-protocol';

interface VideoFrameCallbackMetadata {
  mediaTime: number;
  presentedFrames: number;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameCallbackMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface FramePumpOptions {
  width?: number;
  height?: number;
  fps?: number;
  onFrame: (header: FramePacketHeader, buffer: ArrayBuffer) => void;
  onError?: (message: string) => void;
}

/**
 * Pulls frames from the camera video element, scales them to a predictable
 * RGBA size, and hands them to the preload frame port. The worker path uses
 * ImageBitmap (transferred, not copied) and OffscreenCanvas; if either is
 * unavailable the pump falls back to a main-thread canvas.
 *
 * Frames are never recorded. The pump stops with the session and releases its
 * worker, timers, and canvas.
 */
export class FramePump {
  private width: number;
  private height: number;
  private readonly targetWidth: number;
  private readonly targetHeight: number;
  private readonly fps: number;
  private readonly onFrame: FramePumpOptions['onFrame'];
  private readonly onError: FramePumpOptions['onError'];

  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private timer: number | null = null;
  private callbackHandle: number | null = null;
  private running = false;
  private inFlight = false;
  private pendingSince = 0;
  private useWorker = false;
  private clock = new FrameClock();

  constructor(options: FramePumpOptions) {
    this.targetWidth = options.width ?? CAPTURE_WIDTH;
    this.targetHeight = options.height ?? CAPTURE_HEIGHT;
    this.width = this.targetWidth;
    this.height = this.targetHeight;
    this.fps = options.fps ?? CAPTURE_FPS;
    this.onFrame = options.onFrame;
    this.onError = options.onError;
  }

  start(video: HTMLVideoElement): void {
    this.stop();
    this.video = video;
    // Preserve the camera's native aspect ratio. The previous fixed 640x480
    // conversion stretched the normal 1280x720 browser stream, which can make
    // SmartSpectra's face/chest processing graph fail instead of validate.
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (sourceWidth > 0 && sourceHeight > 0) {
      const scale = Math.min(1, this.targetWidth / sourceWidth, this.targetHeight / sourceHeight);
      this.width = Math.max(16, Math.round((sourceWidth * scale) / 2) * 2);
      this.height = Math.max(16, Math.round((sourceHeight * scale) / 2) * 2);
    } else {
      this.width = this.targetWidth;
      this.height = this.targetHeight;
    }
    this.clock = new FrameClock();
    this.running = true;
    this.inFlight = false;
    this.initWorker();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.inFlight = false;
    const video = this.video as VideoWithFrameCallback | null;
    if (video && this.callbackHandle !== null && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.callbackHandle);
    }
    this.callbackHandle = null;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.canvas = null;
    this.context = null;
    this.video = null;
    this.useWorker = false;
  }

  get active(): boolean {
    return this.running;
  }

  private initWorker(): void {
    if (
      typeof Worker === 'undefined' ||
      typeof createImageBitmap !== 'function' ||
      typeof OffscreenCanvas === 'undefined'
    ) {
      this.useWorker = false;
      return;
    }
    try {
      const worker = new Worker(new URL('./frame-worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<FrameWorkerResponse>) => {
        this.inFlight = false;
        const { buffer, width, height, timestampUs } = event.data;
        if (!this.running) return;
        if (buffer.byteLength < width * height * 4) return;
        this.onFrame({ width, height, stride: width * 4, format: 'rgba', timestampUs }, buffer);
      };
      worker.onerror = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        this.useWorker = false;
        this.inFlight = false;
      };
      this.worker = worker;
      this.useWorker = true;
    } catch {
      this.useWorker = false;
      this.worker = null;
    }
  }

  private schedule(): void {
    const video = this.video as VideoWithFrameCallback | null;
    if (!this.running || !video) return;

    if (video.requestVideoFrameCallback) {
      const onFrame = (): void => {
        if (!this.running) return;
        this.schedule();
        void this.grab();
      };
      this.callbackHandle = video.requestVideoFrameCallback(onFrame);
      return;
    }

    this.timer = window.setInterval(
      () => {
        void this.grab();
      },
      Math.max(16, Math.round(1000 / this.fps)),
    );
  }

  private async grab(): Promise<void> {
    if (!this.running || !this.video) return;

    const now = performance.now();
    if (this.inFlight) {
      // A stalled decode must never freeze the pump forever.
      if (now - this.pendingSince < 500) return;
      this.inFlight = false;
    }

    this.inFlight = true;
    this.pendingSince = now;
    const timestampUs = this.clock.next();
    const video = this.video;

    if (this.useWorker && this.worker) {
      try {
        const bitmap = await createImageBitmap(video, {
          resizeWidth: this.width,
          resizeHeight: this.height,
          resizeQuality: 'low',
        });
        this.worker.postMessage({ bitmap, width: this.width, height: this.height, timestampUs }, [
          bitmap,
        ]);
        return;
      } catch {
        this.inFlight = false;
        this.useWorker = false;
        this.worker?.terminate();
        this.worker = null;
      }
    }

    this.grabOnMainThread(timestampUs);
  }

  private grabOnMainThread(timestampUs: number): void {
    try {
      const video = this.video;
      if (!video) return;
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.context = this.canvas.getContext('2d', {
          alpha: false,
          willReadFrequently: true,
        });
      }
      if (!this.context) throw new Error('Canvas 2D is unavailable.');
      this.context.drawImage(video, 0, 0, this.width, this.height);
      const image = this.context.getImageData(0, 0, this.width, this.height);
      const buffer = image.data.buffer as ArrayBuffer;
      if (buffer.byteLength >= this.width * this.height * 4) {
        this.onFrame(
          {
            width: this.width,
            height: this.height,
            stride: this.width * 4,
            format: 'rgba',
            timestampUs,
          },
          buffer,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError?.(message);
    } finally {
      this.inFlight = false;
    }
  }
}
