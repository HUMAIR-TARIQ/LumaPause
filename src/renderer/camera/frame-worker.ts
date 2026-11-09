/**
 * Converts camera frames to tightly packed RGBA off the main thread.
 *
 * The worker only transforms pixels that are already in memory for the active
 * session. Nothing is written to disk, encoded, or posted anywhere except the
 * private frame port owned by the preload bridge.
 */
import type { FrameWorkerRequest, FrameWorkerResponse } from './frame-worker-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FrameWorkerRequest>) => void) | null;
  postMessage(message: FrameWorkerResponse, transfer?: Transferable[]): void;
};

let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;

scope.onmessage = (event: MessageEvent<FrameWorkerRequest>): void => {
  const { bitmap, width, height, timestampUs } = event.data;
  try {
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    if (!context) throw new Error('The frame worker could not create a 2D context.');

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const image = context.getImageData(0, 0, width, height);
    const response: FrameWorkerResponse = {
      buffer: image.data.buffer as ArrayBuffer,
      width,
      height,
      timestampUs,
    };
    scope.postMessage(response, [response.buffer]);
  } catch {
    bitmap.close();
  }
};
