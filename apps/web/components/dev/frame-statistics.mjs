/**
 * Pure bounded sampling for the opt-in browser probe. All times are milliseconds
 * from performance's time origin. Hidden-tab pauses must be excluded by reset(),
 * never by discarding large visible intervals (which would hide real stalls).
 */

/** @typedef {{ count: number, windowDurationMs: number, averageIntervalMs: number | null, p95IntervalMs: number | null, maxIntervalMs: number | null, framesOver25Ms: number }} FrameStatistics */

/**
 * Nearest-rank p95 of strictly increasing, finite, nonnegative timestamps.
 * Invalid/nonincreasing points are ignored without changing the previous valid
 * timestamp. No samples returns null timing metrics rather than fabricated FPS.
 * @param {Iterable<number>} timestamps
 * @returns {FrameStatistics}
 */
export function summarizeFrameTimestamps(timestamps) {
  const intervals = [];
  let previous = null;
  let duration = 0;
  let framesOver25Ms = 0;
  for (const timestamp of timestamps) {
    if (!Number.isFinite(timestamp) || timestamp < 0) continue;
    if (previous !== null && timestamp <= previous) continue;
    if (previous !== null) {
      const interval = timestamp - previous;
      intervals.push(interval);
      duration += interval;
      if (interval > 25) framesOver25Ms += 1;
    }
    previous = timestamp;
  }
  if (intervals.length === 0) {
    return {
      count: 0, windowDurationMs: 0, averageIntervalMs: null,
      p95IntervalMs: null, maxIntervalMs: null, framesOver25Ms: 0,
    };
  }
  intervals.sort((a, b) => a - b);
  return {
    count: intervals.length,
    windowDurationMs: duration,
    averageIntervalMs: duration / intervals.length,
    p95IntervalMs: intervals[Math.ceil(intervals.length * 0.95) - 1] ?? null,
    maxIntervalMs: intervals[intervals.length - 1] ?? null,
    framesOver25Ms,
  };
}

/** Fixed-capacity FIFO. Push does not allocate or sort on animation frames. */
class TimestampRing {
  /** @param {number} capacity */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new RangeError('Timestamp capacity must be an integer of at least 2');
    }
    this.values = new Float64Array(capacity);
    this.next = 0;
    this.size = 0;
  }

  clear() {
    this.next = 0;
    this.size = 0;
  }

  /** @param {number} timestamp */
  push(timestamp) {
    this.values[this.next] = timestamp;
    this.next = (this.next + 1) % this.values.length;
    this.size = Math.min(this.size + 1, this.values.length);
  }

  /** @returns {number[]} */
  ordered() {
    const result = [];
    const start = (this.next - this.size + this.values.length) % this.values.length;
    for (let index = 0; index < this.size; index += 1) {
      result.push(this.values[(start + index) % this.values.length] ?? 0);
    }
    return result;
  }
}

export class FrameSamplingWindow {
  /**
   * Default storage: 2,048 frame timestamps + 256 long-task timestamps (18 KiB
   * total numeric storage). A five-second window covers normal 60–240 Hz
   * displays. If unusually high callback rates fill the buffer, the reported
   * duration shortens and capacityLimited identifies the truncated window.
   * @param {{capacity?: number, taskCapacity?: number, windowMs?: number, warmupMs?: number}} [options]
   */
  constructor({ capacity = 2048, taskCapacity = 256, windowMs = 5000, warmupMs = 1000 } = {}) {
    if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(warmupMs) || warmupMs < 0) {
      throw new RangeError('Window must be positive and warmup must be nonnegative');
    }
    this.frames = new TimestampRing(capacity);
    this.tasks = new TimestampRing(taskCapacity);
    this.windowMs = windowMs;
    this.warmupMs = warmupMs;
    this.eligibleAfter = Infinity;
    /** @type {number | null} */
    this.lastFrame = null;
    /** @type {number | null} */
    this.lastTask = null;
  }

  /** Reset on route/visibility change; no interval bridges the reset. @param {number} now */
  reset(now) {
    this.frames.clear();
    this.tasks.clear();
    this.lastFrame = null;
    this.lastTask = null;
    this.eligibleAfter = Number.isFinite(now) && now >= 0 ? now + this.warmupMs : Infinity;
  }

  /** @param {number} timestamp */
  recordFrame(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp < this.eligibleAfter) return;
    if (this.lastFrame !== null && timestamp <= this.lastFrame) return;
    this.frames.push(timestamp);
    this.lastFrame = timestamp;
  }

  /** Buffered entries from before a reset/warmup are rejected. @param {number} startTime @param {number} duration */
  recordLongTask(startTime, duration) {
    if (!Number.isFinite(startTime) || startTime < this.eligibleAfter || !Number.isFinite(duration) || duration < 50) return;
    if (this.lastTask !== null && startTime <= this.lastTask) return;
    this.tasks.push(startTime);
    this.lastTask = startTime;
  }

  /** @param {number} now @param {boolean} longTasksSupported */
  snapshot(now, longTasksSupported) {
    const validNow = Number.isFinite(now) && now >= 0;
    const cutoff = validNow ? now - this.windowMs : Infinity;
    const retainedFrames = this.frames.ordered();
    // Keep the preceding boundary timestamp: a visible stall can span the
    // entire nominal window and must not disappear just because its start is
    // older than the cutoff. Report its real duration; never infer hidden time.
    const firstRecent = retainedFrames.findIndex((timestamp) => timestamp > cutoff && timestamp <= now);
    const frames = firstRecent === -1
      ? []
      : retainedFrames.slice(Math.max(0, firstRecent - 1)).filter((timestamp) => timestamp <= now);
    const statistics = summarizeFrameTimestamps(frames);
    const start = frames[0] ?? null;
    const end = frames[frames.length - 1] ?? null;
    const retainedTasks = this.tasks.ordered();
    const longTaskCount = longTasksSupported
      ? retainedTasks.filter((timestamp) => start !== null && end !== null && timestamp >= start && timestamp <= end).length
      : null;
    return {
      ...statistics,
      windowStartMs: start,
      windowEndMs: end,
      windowLimitMs: this.windowMs,
      warmupMs: this.warmupMs,
      status: !validNow || now < this.eligibleAfter ? 'warming' : statistics.count === 0 ? 'collecting' : 'ready',
      longTaskCount,
      longTasksSupported,
      capacityLimited: this.frames.size === this.frames.values.length && (retainedFrames[0] ?? -Infinity) > cutoff,
      longTaskCapacityLimited: this.tasks.size === this.tasks.values.length && (retainedTasks[0] ?? -Infinity) > cutoff,
    };
  }
}
