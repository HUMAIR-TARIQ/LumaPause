/**
 * Monotonic epoch-microsecond clock for frame timestamps.
 *
 * VideoFrame timestamps are relative to the media timeline, not the epoch, and
 * wall clocks can jump backwards. The clock anchors once to the epoch, then
 * advances with a monotonic timer, and ratchets so the SDK never sees a
 * duplicate or decreasing timestamp (which it rejects).
 */
export class FrameClock {
  private readonly anchorEpochUs: number;
  private readonly anchorMs: number;
  private readonly nowMs: () => number;
  private lastUs = 0;

  constructor(epochMs: number = Date.now(), nowMs: () => number = () => performance.now()) {
    this.nowMs = nowMs;
    this.anchorMs = nowMs();
    this.anchorEpochUs = Math.round(epochMs * 1000);
  }

  next(): number {
    const elapsedUs = Math.max(0, (this.nowMs() - this.anchorMs) * 1000);
    const estimate = this.anchorEpochUs + Math.round(elapsedUs);
    this.lastUs = Math.max(this.lastUs + 1, estimate);
    return this.lastUs;
  }

  get lastTimestampUs(): number {
    return this.lastUs;
  }
}
