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

interface ProcessorVideoFrame {
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly timestamp: number;
  close(): void;
}

interface TrackProcessor {
  readonly readable: ReadableStream<ProcessorVideoFrame>;
}

type TrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => TrackProcessor;

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
  private processorReader: ReadableStreamDefaultReader<ProcessorVideoFrame> | null = null;
  private processorTrack: MediaStreamTrack | null = null;

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
    if (this.startTrackProcessor(video)) return;
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
    if (this.processorReader) {
      void this.processorReader.cancel().catch(() => undefined);
      this.processorReader = null;
    }
    this.processorTrack?.stop();
    this.processorTrack = null;
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

  /**
   * SmartSpectra's supported Electron renderer path consumes VideoFrames from
   * MediaStreamTrackProcessor. It avoids createImageBitmap/worker backpressure,
   * which can drop enough frames to trigger validation code 11 and SDK error 8.
   */
  private startTrackProcessor(video: HTMLVideoElement): boolean {
    const Processor = (
      globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessorConstructor }
    ).MediaStreamTrackProcessor;
    const stream = video.srcObject;
    if (!Processor || !(stream instanceof MediaStream)) return false;
    const sourceTrack = stream.getVideoTracks()[0];
    if (!sourceTrack || typeof OffscreenCanvas === 'undefined') return false;

    try {
      this.processorTrack = sourceTrack.clone();
      const processor = new Processor({ track: this.processorTrack });
      const reader = processor.readable.getReader();
      this.processorReader = reader;
      void this.runTrackProcessor(reader);
      return true;
    } catch {
      this.processorTrack?.stop();
      this.processorTrack = null;
      this.processorReader = null;
      return false;
    }
  }

  private async runTrackProcessor(
    reader: ReadableStreamDefaultReader<ProcessorVideoFrame>,
  ): Promise<void> {
    let canvas: OffscreenCanvas | null = null;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    try {
      while (this.running && this.processorReader === reader) {
        const read = await reader.read();
        if (read.done || !read.value) break;
        const frame = read.value;
        try {
          const sourceWidth = frame.codedWidth;
          const sourceHeight = frame.codedHeight;
          const scale = Math.min(
            1,
            this.targetWidth / sourceWidth,
            this.targetHeight / sourceHeight,
          );
          const width = Math.max(16, Math.round((sourceWidth * scale) / 2) * 2);
          const height = Math.max(16, Math.round((sourceHeight * scale) / 2) * 2);
          if (!canvas || canvas.width !== width || canvas.height !== height) {
            canvas = new OffscreenCanvas(width, height);
            context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
          }
          if (!context) throw new Error('Offscreen camera canvas is unavailable.');
          context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height);
          const image = context.getImageData(0, 0, width, height);
          const timestampUs = this.clock.next(frame.timestamp);
          this.onFrame(
            { width, height, stride: width * 4, format: 'rgba', timestampUs },
            image.data.buffer as ArrayBuffer,
          );
        } finally {
          frame.close();
        }
      }
    } catch (error) {
      if (this.running) {
        const message = error instanceof Error ? error.message : String(error);
        this.onError?.(message);
      }
    }
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
      const onFrame = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
        if (!this.running) return;
        this.schedule();
        // mediaTime is the actual capture/presentation clock in seconds. Using
        // it prevents canvas/worker jitter from looking like a low-FPS camera
        // to SmartSpectra.
        void this.grab(metadata.mediaTime * 1_000_000);
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

  private async grab(mediaTimestampUs?: number): Promise<void> {
    if (!this.running || !this.video) return;

    const now = performance.now();
    if (this.inFlight) {
      // A stalled decode must never freeze the pump forever.
      if (now - this.pendingSince < 500) return;
      this.inFlight = false;
    }

    this.inFlight = true;
    this.pendingSince = now;
    const timestampUs = this.clock.next(mediaTimestampUs);
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
