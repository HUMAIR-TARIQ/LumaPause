/** Messages exchanged with the frame worker. Frames exist only in memory. */

export interface FrameWorkerRequest {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  timestampUs: number;
}

export interface FrameWorkerResponse {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  timestampUs: number;
}
