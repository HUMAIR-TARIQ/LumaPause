import { describe, expect, it } from 'vitest';
import { FrameClock } from '../../src/renderer/camera/frame-clock';

const EPOCH = 1_760_000_000_000;

describe('FrameClock', () => {
  it('anchors to the epoch and advances with the monotonic timer', () => {
    let now = 100;
    const clock = new FrameClock(EPOCH, () => now);
    expect(clock.next()).toBe(EPOCH * 1_000);
    now = 140;
    expect(clock.next()).toBe(EPOCH * 1_000 + 40_000);
    expect(clock.lastTimestampUs).toBe(EPOCH * 1_000 + 40_000);
  });

  it('never emits a duplicate or decreasing timestamp when the timer stalls', () => {
    const now = 100;
    const clock = new FrameClock(EPOCH, () => now);
    const first = clock.next();
    const second = clock.next();
    const third = clock.next();
    expect(second).toBe(first + 1);
    expect(third).toBe(second + 1);
  });

  it('survives a backwards clock without regressing timestamps', () => {
    let now = 500;
    const clock = new FrameClock(EPOCH, () => now);
    const before = clock.next();
    now = 200;
    const after = clock.next();
    expect(after).toBe(before + 1);
  });

  it('rounds epoch milliseconds to whole microseconds', () => {
    const clock = new FrameClock(1_760_000_000_000.1234, () => 0);
    expect(clock.next()).toBe(1_760_000_000_000_123);
    expect(Number.isInteger(clock.lastTimestampUs)).toBe(true);
  });

  it('anchors camera media timestamps so processing jitter does not change frame cadence', () => {
    let now = 100;
    const clock = new FrameClock(EPOCH, () => now);
    const first = clock.next(5_000_000);
    now = 900; // Pixel conversion was slow, but the next camera frame is 33.333 ms later.
    const second = clock.next(5_033_333);
    expect(first).toBe(EPOCH * 1_000);
    expect(second - first).toBe(33_333);
  });
});
