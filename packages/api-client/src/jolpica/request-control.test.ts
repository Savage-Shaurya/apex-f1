import assert from "node:assert/strict";
import { test } from "node:test";
import { JolpicaRequestControl, jolpicaTransportFinished } from "./request-control";
import { ProviderError, retryAfterMs } from "../transport";
import { jolpicaSeasonKeyMatches } from "./index";

test("PERF2-2: the lane paces starts 260 ms apart but lets transports overlap", async () => {
  let now = 0;
  const control = new JolpicaRequestControl({ now: () => now, sleep: async (ms) => { now += ms; } });
  const releases: Array<() => void> = [];
  let running = 0;
  let peak = 0;
  const starts: number[] = [];
  const operation = () => async () => {
    starts.push(now);
    running++;
    peak = Math.max(peak, running);
    await new Promise<void>((resolve) => releases.push(resolve));
    running--;
    return now;
  };
  const reads = ["a", "b", "c"].map((key) => control.readThrough(key, 60, { timeoutMs: 5000 }, operation()));
  for (let i = 0; i < 50 && releases.length < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 3, "all three transports started before any finished");
  assert.equal(peak, 3);
  assert.deepEqual(starts, [0, 260, 520]);
  releases.forEach((release) => release());
  await Promise.all(reads);
});

test("D2-RESILIENCE-2: during an outage repeated views send one attempt per key per cooldown", async () => {
  let now = 1_000_000;
  let physical = 0;
  const control = new JolpicaRequestControl({ now: () => now, sleep: async (ms) => { now += ms; } });
  const failing = async () => { physical++; throw new ProviderError("jolpica", "http", 503); };
  for (let view = 0; view < 8; view++) {
    await assert.rejects(control.readThrough("schedule", 3600, {}, failing), (error) => error instanceof ProviderError && error.status === 503);
    now += 1000;
  }
  assert.equal(physical, 1);
  now += 30_000;
  await assert.rejects(control.readThrough("schedule", 3600, {}, failing));
  assert.equal(physical, 2);
});

test("D2-RESILIENCE-2: an expired validated copy is served stale when the provider fails", async () => {
  let now = 1_000_000;
  const control = new JolpicaRequestControl({ now: () => now, sleep: async (ms) => { now += ms; } });
  assert.deepEqual(await control.readThrough("standings", 60, {}, async () => ({ round: 18 })), { round: 18 });
  now += 61_000;
  assert.deepEqual(await control.readThrough("standings", 60, {}, async () => { throw new ProviderError("jolpica", "network"); }), { round: 18 });
  // Inside the failure cooldown no new attempt is made; the stale copy answers.
  let physical = 0;
  assert.deepEqual(await control.readThrough("standings", 60, {}, async () => { physical++; return { round: 19 }; }), { round: 18 });
  assert.equal(physical, 0);
  // Fresh observations (ingestion) never accept an old copy.
  await assert.rejects(control.readThrough("standings", 0, {}, async () => { throw new ProviderError("jolpica", "network"); }));
  // Past the stale window the failure is reported.
  now += 7 * 3_600_000;
  await assert.rejects(control.readThrough("standings", 60, {}, async () => { throw new ProviderError("jolpica", "network"); }));
});

test("transport-finished classification and Retry-After parsing", () => {
  assert.equal(jolpicaTransportFinished(new ProviderError("jolpica", "http", 500)), true);
  assert.equal(jolpicaTransportFinished(new ProviderError("jolpica", "http", 429)), false);
  assert.equal(jolpicaTransportFinished(new ProviderError("jolpica", "timeout")), false);
  assert.equal(jolpicaTransportFinished(new ProviderError("jolpica", "network")), false);
  assert.equal(jolpicaTransportFinished(new ProviderError("jolpica", "invalid-response")), true);
  assert.equal(retryAfterMs("120"), 120_000);
  assert.equal(retryAfterMs("Thu, 01 Jan 2026 00:01:00 GMT", Date.parse("2026-01-01T00:00:00Z")), 60_000);
  assert.equal(retryAfterMs("soon"), undefined);
  assert.equal(retryAfterMs("99999"), 3_600_000);
});

test("BE-9: season cache keys match relative to the base URL, including the local dev cache", () => {
  assert.equal(jolpicaSeasonKeyMatches("https://api.jolpi.ca/ergast/f1/2026.json?limit=100", 2026, true, "https://api.jolpi.ca/ergast/f1"), true);
  assert.equal(jolpicaSeasonKeyMatches("https://api.jolpi.ca/ergast/f1/current/driverStandings.json", 2026, true, "https://api.jolpi.ca/ergast/f1"), true);
  assert.equal(jolpicaSeasonKeyMatches("https://api.jolpi.ca/ergast/f1/current/driverStandings.json", 2026, false, "https://api.jolpi.ca/ergast/f1"), false);
  assert.equal(jolpicaSeasonKeyMatches("http://127.0.0.1:4777/jolpica/2026/5/results.json", 2026, false, "http://127.0.0.1:4777/jolpica"), true);
  assert.equal(jolpicaSeasonKeyMatches("http://127.0.0.1:4777/jolpica/2025.json", 2026, false, "http://127.0.0.1:4777/jolpica"), false);
  assert.equal(jolpicaSeasonKeyMatches("http://127.0.0.1:4777/jolpica/drivers/2026.json", 2026, false, "http://127.0.0.1:4777/jolpica"), false);
  assert.equal(jolpicaSeasonKeyMatches("https://evil.example/ergast/f1/2026.json", 2026, false, "https://api.jolpi.ca/ergast/f1"), false);
});

test('R3-CODE-4: a read that times out in this process\'s own start queue is not remembered as a Jolpica failure', async () => {
  let clock = 0;
  const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
  let upstream = 0;
  await control.readThrough('a', 3600, { timeoutMs: 1000 }, async () => { upstream++; return { a: 1 }; });
  // The 260 ms start gap cannot fit inside a 100 ms deadline: local congestion, no upstream attempt.
  await assert.rejects(control.readThrough('b', 3600, { timeoutMs: 100 }, async () => { upstream++; return { b: 1 }; }), (error: unknown) => error instanceof ProviderError && error.code === 'timeout');
  assert.equal(upstream, 1);
  // The next read of the same key tries Jolpica instead of replaying the local timeout for 30 s.
  assert.deepEqual(await control.readThrough('b', 3600, { timeoutMs: 1000 }, async () => { upstream++; return { b: 2 }; }), { b: 2 });
  assert.equal(upstream, 2);
});

test('R3-CODE-4: an upstream failure after the request started is still remembered', async () => {
  let clock = 0;
  const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
  let upstream = 0;
  await assert.rejects(control.readThrough('c', 3600, { timeoutMs: 1000 }, async () => { upstream++; throw new ProviderError('jolpica', 'http', 503); }));
  await assert.rejects(control.readThrough('c', 3600, { timeoutMs: 1000 }, async () => { upstream++; return { c: 1 }; }));
  assert.equal(upstream, 1);
});
