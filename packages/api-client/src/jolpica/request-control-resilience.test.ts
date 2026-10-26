import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JolpicaRequestControl } from './request-control';
import { ProviderError } from '../transport';

// Audit F-01 (build reliability) and F-02 (one 429 made every uncached Jolpica page 500).
const BASE = 'https://api.jolpi.ca/ergast/f1';
const standings = `${BASE}/2026/driverStandings.json?limit=100&offset=0`;
const schedule = `${BASE}/2026.json?limit=100&offset=0`;
const careerPage = `${BASE}/drivers/alonso/results.json?limit=100&offset=100`;

function clock(start = 1_000_000) {
  const state = { now: start };
  return { state, now: () => state.now, sleep: async (ms: number) => { state.now += ms; } };
}
const rateLimited = (retryAfterMs?: number) => async (): Promise<never> => { throw new ProviderError('jolpica', 'http', 429, retryAfterMs); };

/** In-memory last-good store standing in for Upstash, shared by several "instances". */
function sharedLastGood() {
  const values = new Map<string, { storedAt: number; value: unknown }>();
  return { values, read: async (key: string) => values.get(key) ?? null, write: async (key: string, entry: { storedAt: number; value: unknown }) => { values.set(key, entry); } };
}

/** Same claim semantics as the per-build disk store, shared by several "build workers". */
function sharedBuildStore() {
  const values = new Map<string, unknown>();
  const claims = new Set<string>();
  return {
    values,
    async claimOrWait(key: string, deadline: number) {
      for (;;) {
        if (values.has(key)) return { value: values.get(key) };
        if (!claims.has(key)) { claims.add(key); return null; }
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    },
    async write(key: string, value: unknown) { values.set(key, value); claims.delete(key); },
    async release(key: string) { claims.delete(key); },
  };
}

test('F-02: a 429 on one endpoint class does not refuse reads of other classes', async () => {
  const time = clock();
  const control = new JolpicaRequestControl({ now: time.now, sleep: time.sleep });
  await assert.rejects(control.readThrough(standings, 300, { timeoutMs: 6000 }, rateLimited()));
  let physical = 0;
  assert.deepEqual(await control.readThrough(schedule, 300, { timeoutMs: 6000 }, async () => { physical++; return { races: 23 }; }), { races: 23 });
  assert.equal(physical, 1, 'the schedule read went to Jolpica instead of failing with rate-limit');
});

test('F-02: without Retry-After a 429 pauses its class for seconds, not a minute', async () => {
  const time = clock();
  const control = new JolpicaRequestControl({ now: time.now, sleep: time.sleep });
  await assert.rejects(control.readThrough(standings, 300, { timeoutMs: 6000 }, rateLimited()));
  time.state.now += 16_000;
  const other = `${BASE}/2026/constructorStandings.json?limit=100&offset=0`;
  assert.deepEqual(await control.readThrough(other, 300, { timeoutMs: 6000 }, async () => ({ ok: 1 })), { ok: 1 });
});

test('F-02: Retry-After is honoured and a short pause is queued instead of failing the page', async () => {
  const time = clock();
  const control = new JolpicaRequestControl({ now: time.now, sleep: time.sleep });
  await assert.rejects(control.readThrough(standings, 300, { timeoutMs: 6000 }, rateLimited(2_000)));
  const other = `${BASE}/2026/constructorStandings.json?limit=100&offset=0`;
  const before = time.state.now;
  assert.deepEqual(await control.readThrough(other, 300, { timeoutMs: 6000 }, async () => ({ queued: true })), { queued: true });
  assert.ok(time.state.now - before >= 2_000, 'the read waited for the pause to end');
  // A pause longer than the read's budget still refuses at once (the page then uses its stale copy or outage state).
  await assert.rejects(control.readThrough(careerPage, 300, { timeoutMs: 6000 }, rateLimited(40_000)));
  const careerFirst = `${BASE}/drivers/alonso/results.json?limit=100&offset=0`;
  await assert.rejects(control.readThrough(careerFirst, 300, { timeoutMs: 6000 }, async () => 'never'), /rate-limit/);
  time.state.now += 40_001;
  assert.equal(await control.readThrough(careerFirst, 300, { timeoutMs: 6000 }, async () => 'later'), 'later');
});

test('F-02: a cold instance serves the last-good copy another instance validated instead of a 500', async () => {
  const time = clock();
  const lastGood = sharedLastGood();
  const warm = new JolpicaRequestControl({ now: time.now, sleep: time.sleep, lastGood });
  assert.deepEqual(await warm.readThrough(standings, 300, { timeoutMs: 6000 }, async () => ({ round: 18 })), { round: 18 });
  for (let i = 0; i < 5 && !lastGood.values.size; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lastGood.values.size, 1, 'a successful read leaves a shared last-good copy');
  time.state.now += 3_600_000;
  const cold = new JolpicaRequestControl({ now: time.now, sleep: time.sleep, lastGood });
  assert.deepEqual(await cold.readThrough(standings, 300, { timeoutMs: 6000 }, rateLimited()), { round: 18 });
  // During the cooldown the cold instance answers from the shared copy without a physical request.
  let physical = 0;
  assert.deepEqual(await cold.readThrough(standings, 300, { timeoutMs: 6000 }, async () => { physical++; return { round: 19 }; }), { round: 18 });
  assert.equal(physical, 0);
});

test('F-02: live data is served stale only inside the stale window; completed seasons at any age', async () => {
  const time = clock(Date.parse('2026-10-26T12:00:00Z'));
  const lastGood = sharedLastGood();
  const old = `${BASE}/1983/constructorStandings.json?limit=100&offset=0`;
  await lastGood.write(standings, { storedAt: time.state.now - 7 * 3_600_000, value: { round: 17 } });
  await lastGood.write(old, { storedAt: time.state.now - 20 * 86_400_000, value: { season: 1983 } });
  const control = new JolpicaRequestControl({ now: time.now, sleep: time.sleep, lastGood });
  await assert.rejects(control.readThrough(standings, 300, { timeoutMs: 6000 }, async () => { throw new ProviderError('jolpica', 'http', 503); }));
  assert.deepEqual(await control.readThrough(old, 300, { timeoutMs: 6000 }, async () => { throw new ProviderError('jolpica', 'http', 503); }), { season: 1983 });
});

test('F-02: the shared backoff after a 429 is scoped to the endpoint class', async () => {
  const pauses: Array<[number, string | undefined]> = [];
  const reserved: Array<string | undefined> = [];
  const time = clock();
  const control = new JolpicaRequestControl({
    now: time.now, sleep: time.sleep,
    sharedAdmission: {
      reserve: async (_owner: string, _signal: AbortSignal, scope?: string) => { reserved.push(scope); return { admitted: true, retryMs: 0, remainingMs: 35000 }; },
      complete: async () => undefined,
      backoff: async (ms: number, _signal: AbortSignal, scope?: string) => { pauses.push([ms, scope]); },
    },
  });
  await assert.rejects(control.readThrough(standings, 300, { timeoutMs: 6000 }, rateLimited()));
  assert.deepEqual(pauses, [[15_000, 'standings']]);
  assert.deepEqual(reserved, ['standings']);
});

test('F-01: build workers share one physical read per URL through the per-build store', async () => {
  const store = sharedBuildStore();
  let physical = 0;
  const transport = async () => { physical++; await new Promise((resolve) => setTimeout(resolve, 20)); return { standings: 23 }; };
  const workers = Array.from({ length: 4 }, () => new JolpicaRequestControl({ buildPhase: () => true, buildStore: store, sleep: async () => undefined }));
  const results = await Promise.all(workers.map((worker) => worker.readThrough(standings, 300, { timeoutMs: 96_000 }, transport)));
  assert.equal(physical, 1, 'four workers, one Jolpica request');
  assert.ok(results.every((result) => JSON.stringify(result) === '{"standings":23}'));
});

test('F-01: during the build a read may wait out a queue longer than its 6 s transport timeout', async () => {
  const time = clock();
  const build = new JolpicaRequestControl({ now: time.now, sleep: time.sleep, buildPhase: () => true });
  // An 8 s pause (Retry-After) stands in for a long admission queue in front of the read.
  await assert.rejects(build.readThrough(careerPage, 300, { timeoutMs: 96_000 }, rateLimited(8_000)));
  const careerFirst = `${BASE}/drivers/alonso/results.json?limit=100&offset=0`;
  assert.equal(await build.readThrough(careerFirst, 300, { timeoutMs: 96_000 }, async () => 'built'), 'built');
  // The same wait at runtime is refused: a visitor never waits beyond the render budget.
  const runtime = new JolpicaRequestControl({ now: time.now, sleep: time.sleep, buildPhase: () => false });
  await assert.rejects(runtime.readThrough(careerPage, 300, { timeoutMs: 96_000 }, rateLimited(40_000)));
  await assert.rejects(runtime.readThrough(careerFirst + '&x=1', 300, { timeoutMs: 96_000 }, async () => 'never'), /rate-limit/);
});
