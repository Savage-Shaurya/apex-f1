import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameSamplingWindow, summarizeFrameTimestamps } from '../components/dev/frame-statistics.mjs';

test('constant 120 Hz timestamps preserve measured duration and interval without FPS assumptions', () => {
  const timestamps = Array.from({ length: 121 }, (_, index) => 3000 + index * 1000 / 120);
  const result = summarizeFrameTimestamps(timestamps);
  assert.equal(result.count, 120);
  assert.equal(result.windowDurationMs, 1000);
  assert.ok(Math.abs(result.averageIntervalMs - 1000 / 120) < 1e-10);
  assert.ok(Math.abs(result.p95IntervalMs - 1000 / 120) < 1e-10);
  assert.equal(result.framesOver25Ms, 0);
});

test('nearest-rank p95 separates the slow tail from a single worst stall', () => {
  // 18 intervals of 10ms, then 25ms, then one 500ms stall: rank19 is 25ms.
  const timestamps = [0];
  for (const interval of [...Array(18).fill(10), 25, 500]) timestamps.push(timestamps.at(-1) + interval);
  assert.deepEqual(summarizeFrameTimestamps(timestamps), {
    count: 20, windowDurationMs: 705, averageIntervalMs: 35.25,
    p95IntervalMs: 25, maxIntervalMs: 500, framesOver25Ms: 1,
  });
});

test('empty, single, nonfinite and nonincreasing values never fabricate timing samples', () => {
  for (const values of [[], [16], [NaN, Infinity, -Infinity, -1]]) {
    assert.deepEqual(summarizeFrameTimestamps(values), {
      count: 0, windowDurationMs: 0, averageIntervalMs: null,
      p95IntervalMs: null, maxIntervalMs: null, framesOver25Ms: 0,
    });
  }
  assert.deepEqual(summarizeFrameTimestamps([0, NaN, 10, 10, 5, Infinity, 25, 51]), {
    count: 3, windowDurationMs: 51, averageIntervalMs: 17,
    p95IntervalMs: 26, maxIntervalMs: 26, framesOver25Ms: 1,
  });
});

test('warmup and visibility/route reset exclude a hidden-minute pause but retain visible stalls', () => {
  const sampler = new FrameSamplingWindow({ warmupMs: 100 });
  sampler.reset(0);
  for (const timestamp of [0, 16, 99, 100, 110, 410]) sampler.recordFrame(timestamp);
  let result = sampler.snapshot(410, true);
  assert.equal(result.count, 2);
  assert.equal(result.maxIntervalMs, 300);
  sampler.reset(60410);
  // Delayed entries from the previous route/tab epoch must not enter new data.
  sampler.recordFrame(60420);
  sampler.recordLongTask(410, 100);
  sampler.recordLongTask(60450, 100);
  sampler.recordFrame(60510);
  sampler.recordFrame(60526);
  result = sampler.snapshot(60526, true);
  assert.equal(result.count, 1);
  assert.equal(result.maxIntervalMs, 16);
  assert.equal(result.windowDurationMs, 16);
  assert.equal(result.longTaskCount, 0);
});

test('bounded ring keeps chronological recent samples and reports capacity-limited coverage', () => {
  const sampler = new FrameSamplingWindow({ capacity: 4, warmupMs: 0, windowMs: 1000 });
  sampler.reset(0);
  for (const timestamp of [0, 10, 20, 40, 70, 110]) sampler.recordFrame(timestamp);
  const result = sampler.snapshot(110, true);
  assert.equal(result.count, 3);
  assert.equal(result.windowStartMs, 20);
  assert.equal(result.windowEndMs, 110);
  assert.equal(result.windowDurationMs, 90);
  assert.equal(result.averageIntervalMs, 30);
  assert.equal(result.p95IntervalMs, 40);
  assert.equal(result.framesOver25Ms, 2);
  assert.equal(result.capacityLimited, true);
});

test('rolling cutoff counts only observed intervals and long tasks in the same retained frame window', () => {
  const sampler = new FrameSamplingWindow({ warmupMs: 0, windowMs: 100 });
  sampler.reset(0);
  for (const timestamp of [0, 50, 100, 150, 200]) sampler.recordFrame(timestamp);
  for (const [start, duration] of [[50, 100], [100, 50], [125, 70], [175, 49], [190, NaN], [250, 100]]) sampler.recordLongTask(start, duration);
  const result = sampler.snapshot(200, true);
  assert.equal(result.count, 2);
  assert.equal(result.windowDurationMs, 100);
  assert.equal(result.windowStartMs, 100);
  assert.equal(result.longTaskCount, 2);
  assert.equal(sampler.snapshot(200, false).longTaskCount, null);
  assert.equal(sampler.snapshot(400, true).count, 0);
  assert.equal(sampler.snapshot(400, true).averageIntervalMs, null);
});

test('invalid reset/configuration cannot accidentally join old samples', () => {
  assert.throws(() => new FrameSamplingWindow({ capacity: 1 }), RangeError);
  assert.throws(() => new FrameSamplingWindow({ windowMs: Infinity }), RangeError);
  const sampler = new FrameSamplingWindow({ warmupMs: 0 });
  sampler.reset(0);
  sampler.recordFrame(0);
  sampler.recordFrame(16);
  sampler.reset(NaN);
  sampler.recordFrame(60000);
  assert.equal(sampler.snapshot(60000, true).count, 0);
  sampler.reset(60000);
  for (const timestamp of [60000, Infinity, -1, NaN, 59990, 60016]) sampler.recordFrame(timestamp);
  assert.equal(sampler.snapshot(60016, true).maxIntervalMs, 16);
  assert.equal(sampler.snapshot(NaN, true).count, 0);
});

test('a visible stall spanning the entire rolling cutoff remains a real measured interval', () => {
  const sampler = new FrameSamplingWindow({ warmupMs: 0, windowMs: 5000 });
  sampler.reset(0);
  sampler.recordFrame(0);
  sampler.recordFrame(16);
  sampler.recordFrame(6016);
  const result = sampler.snapshot(6016, true);
  assert.equal(result.count, 1);
  assert.equal(result.windowStartMs, 16);
  assert.equal(result.windowDurationMs, 6000);
  assert.equal(result.maxIntervalMs, 6000);
  assert.equal(result.framesOver25Ms, 1);
});
