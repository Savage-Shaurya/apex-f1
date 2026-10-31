/**
 * Redis is optional (incident 2026-10-31). Every Upstash failure mode
 * (the exact quota-exceeded 400, 401, 500, timeout, refused connection,
 * garbage) × each web consumer: rate limiter, health, OpenF1 page reads.
 * Reads stay open, sensitive writes stay limited (in-memory), administrator
 * authentication refuses, and nothing becomes a provider outage.
 */
import 'next/dist/server/node-environment';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { rateLimitShared } from '../lib/distributed-rate-limit';
import { runHealthChecks } from '../lib/health';
import { createOpenF1PageReader, createPageOpenF1Reader } from '../lib/openf1-shared-reader';
import { createUpstashOpenF1ReadStore, type OpenF1ReadStore } from '../lib/openf1-read-store';
import { REDIS_FAILURES, type RedisFailureMode } from '../../../packages/api-client/src/redis-failure-fixtures';
import { redisCommandStats, resetRedisBreakers, resetRedisCommandStats } from '../../../packages/api-client/src/redis-guard';

const MODES = Object.keys(REDIS_FAILURES) as RedisFailureMode[];
const ENV_KEYS = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'APEX_REDIS_SCOPE'] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let redisCalls = 0;

function useRedis(mode: RedisFailureMode) {
  redisCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'fixture-db.upstash.io') throw new Error(`unexpected host ${url.hostname}`);
    redisCalls += 1;
    return REDIS_FAILURES[mode](input, init);
  }) as typeof fetch;
}

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://fixture-db.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'fixture-token', APEX_REDIS_SCOPE: 'redisopt',
  });
  resetRedisBreakers(); resetRedisCommandStats();
  console.warn = () => {};
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

let ip = 0;
const request = () => new Request('https://apex.example/api/test', { headers: { 'x-vercel-forwarded-for': `198.51.100.${(ip++ % 250) + 1}` } });

for (const mode of MODES) {
  test(`rate limiter, Upstash ${mode}: reads stay open under the in-memory limit; writes and admin refuse with 503`, async () => {
    useRedis(mode);
    const reader = request();
    const read = { limit: 3, windowMs: 60_000, bucket: `redisopt-read-${mode}`, readFallback: true };
    const reads = [];
    for (let i = 0; i < 5; i++) reads.push(await rateLimitShared(reader, read));
    assert.deepEqual(reads.map((r) => r.ok), [true, true, true, false, false], 'a read keeps a limit, never unlimited');
    assert.ok(reads.every((r) => r.available && r.store === 'local'));

    // Owner decision (review R-03): public writes and admin refuse while Redis is unavailable.
    for (const bucket of ['newsletter', 'predict', 'predict-identity-create', 'articles-write', 'admin-login-network']) {
      const write = await rateLimitShared(request(), { limit: 20, windowMs: 60_000, bucket: `${bucket}-${mode}` });
      assert.equal(write.available, false, bucket);
      assert.equal(write.ok, false);
      assert.equal(write.store, 'unavailable');
    }
  });
}

test('rate limiter: after a quota reply the breaker keeps later requests off Redis entirely', async () => {
  useRedis('quota');
  for (let i = 0; i < 25; i++) await rateLimitShared(request(), { limit: 120, windowMs: 60_000, bucket: 'redisopt-breaker', readFallback: true });
  assert.equal(redisCalls, 1);
});

test('rate limiter without any Upstash configuration in production: reads limited in memory, writes refuse', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  const reader = request();
  const read = { limit: 1, windowMs: 60_000, bucket: 'redisopt-noconf-read', readFallback: true };
  assert.equal((await rateLimitShared(reader, read)).ok, true);
  assert.equal((await rateLimitShared(reader, read)).ok, false);
  assert.equal((await rateLimitShared(request(), { limit: 5, windowMs: 60_000, bucket: 'redisopt-noconf-write' })).available, false);
});

test('health: Redis down or unconfigured never makes the service "down"; database down still does', async () => {
  const env = { VERCEL_ENV: 'production', DATABASE_URL: 'postgres://x', UPSTASH_REDIS_REST_URL: 'https://fixture-db.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' };
  const ok = async () => undefined;
  const redisDown = await runHealthChecks({ env, database: ok, redis: async () => { throw new Error('quota'); }, provider: ok });
  assert.equal(redisDown.httpStatus, 200);
  assert.equal(redisDown.body.status, 'degraded');
  assert.equal(redisDown.body.checks.redis.status, 'down');
  const unconfigured = await runHealthChecks({ env: { VERCEL_ENV: 'production', DATABASE_URL: 'postgres://x' }, database: ok, redis: ok, provider: ok });
  assert.equal(unconfigured.httpStatus, 200);
  assert.equal(unconfigured.body.status, 'ok');
  assert.equal(unconfigured.body.checks.redis.status, 'not-configured');
  const dbDown = await runHealthChecks({ env, database: async () => { throw new Error('x'); }, redis: ok, provider: ok });
  assert.equal(dbDown.httpStatus, 503);
});

// ---- OpenF1 page reads (grid timing on driver/team pages)
const START = Date.parse('2026-10-04T12:00:00Z');
function openf1Source() {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); const path = url.pathname.split('/').at(-1)!; calls.push(path);
    return Response.json(path === 'position' ? [{ session_key: 42, meeting_key: 7, driver_number: 4, date: new Date(START + 59_000).toISOString(), position: 1 }] : []);
  }) as typeof fetch;
  return { fetcher, calls };
}

for (const mode of MODES) {
  test(`OpenF1 page read, Upstash ${mode}: the page reads OpenF1 directly (real rows), and later reads skip Redis`, async () => {
    let commands = 0;
    const upstash = (async (input: unknown, init?: RequestInit) => { commands += 1; return REDIS_FAILURES[mode](input, init); }) as typeof fetch;
    const store = createUpstashOpenF1ReadStore({ url: 'https://fixture-db.upstash.io', token: 'fixture-token' }, { fetch: upstash, timeoutMs: 200 });
    const source = openf1Source();
    let clock = START + 60_000;
    const deps = { store, fetch: source.fetcher, lastGoodStore: null, now: () => clock, wait: async (ms: number) => { clock += ms; } };
    const first = await createOpenF1PageReader(deps).getPositions(42);
    assert.equal(first.length, 1, 'real OpenF1 rows, not an unavailable state');
    assert.deepEqual(source.calls, ['position']);
    const used = commands;
    clock += 5_000;
    const second = await createOpenF1PageReader(deps).getPositions(42);
    assert.equal(second.length, 1);
    assert.equal(commands, used, 'the shared store is known to be down: no Redis command');
  });
}

/** Counts every call a page makes to the shared read store (one call = one Redis command). */
function countingStore(): { store: OpenF1ReadStore; calls: () => number } {
  let calls = 0;
  const caches = new Map<string, { writtenAt: number; rows: unknown[] }>();
  let fence = 0;
  const store: OpenF1ReadStore = {
    async read(query) { calls++; const c = caches.get(query); return c ? { version: 1, query, writtenAt: c.writtenAt, rows: structuredClone(c.rows) } : null; },
    async claim() { calls++; return { owner: true, fence: ++fence, retryMs: 0 }; },
    async admit() { calls++; return { retryMs: 0, busy: false }; },
    async publish(query, _owner, _fence, rows) { calls++; const writtenAt = START + 60_000; caches.set(query, { writtenAt, rows }); return { version: 1, query, writtenAt, rows: structuredClone(rows) }; },
    async release() { calls++; },
    async complete() { calls++; },
  };
  return { store, calls: () => calls };
}

/**
 * Command budget (DEPLOY.md "Redis usage budget"): a warm instance answering
 * the same OpenF1 query for 100 page renders inside the shared cache's
 * lifetime spends the commands of the first render only (≤ 7: read, claim,
 * raced read, admit, publish, complete, release).
 */
test('command budget: 100 page renders of one OpenF1 query on a warm instance cost ≤ 7 store commands', async () => {
  const counted = countingStore();
  const source = openf1Source();
  const clock = START + 60_000;
  const deps = { store: counted.store, fetch: source.fetcher, lastGoodStore: null, now: () => clock, wait: async () => {}, processMemo: true };
  for (let i = 0; i < 100; i++) assert.equal((await createOpenF1PageReader(deps).getPositions(42)).length, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(counted.calls() <= 7, `${counted.calls()} store commands`);
  assert.equal(source.calls.length, 1);
});

test('health and rate-limit commands are counted per consumer (guarded fetch)', async () => {
  useRedis('server');
  await rateLimitShared(request(), { limit: 5, windowMs: 60_000, bucket: 'redisopt-count', readFallback: true });
  assert.equal(redisCommandStats().byConsumer['rate-limit'], 1);
});

test('command budget: during next build the page OpenF1 reader spends zero Redis commands (no shared locks to poll)', async () => {
  const previous = process.env.NEXT_PHASE;
  process.env.NEXT_PHASE = 'phase-production-build';
  let redis = 0, openf1 = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname.endsWith('upstash.io')) { redis++; return Response.json({ result: null }); }
    openf1++;
    return Response.json([{ session_key: 42, meeting_key: 7, driver_number: 4, date: new Date(START + 59_000).toISOString(), position: 1 }]);
  }) as typeof fetch;
  try {
    const rows = await createPageOpenF1Reader().getPositions(42);
    assert.equal(rows.length, 1);
    assert.equal(redis, 0);
    assert.equal(openf1, 1);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PHASE; else process.env.NEXT_PHASE = previous;
  }
});

// ---------- Independent review (docs/audit/2026-10-31/redis-review.md) ----------

test('R-02 (E3): client disconnects on the live-store transport (admin session path) never move limits off Redis', async () => {
  let net = 0;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    net++;
    const body = String(init?.body ?? '');
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ result: body.includes('local limit') ? [1, 60_000] : null })), 40);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  }) as typeof fetch;
  const { createUpstashRedisTransport } = await import('../lib/live-shared-store');
  const exec = createUpstashRedisTransport({ url: 'https://fixture-db.upstash.io', token: 'fixturetoken' }, { maxBytes: 4096 });
  for (let i = 0; i < 4; i++) {
    const client = new AbortController();
    const pending = exec(['EVAL', 'return 1', '0'], client.signal);
    setTimeout(() => client.abort(), 5);
    await assert.rejects(pending);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const before = net;
  const write = await rateLimitShared(request(), { limit: 20, windowMs: 60_000, bucket: 'redisopt-e3-predict' });
  assert.equal(write.store, 'upstash', 'Redis is healthy: the shared limit still decides');
  assert.equal(net, before + 1);
});

test('R-05: the health probe sends a data command, so a spent quota (PING still 200) reads as down; cached 5 min', async () => {
  const { cachedRedisProbe, forgetRedisProbe } = await import('../lib/health');
  forgetRedisProbe();
  const commands: string[][] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
    commands.push(command);
    if (command[0] === 'PING') return Response.json({ result: 'PONG' });
    return new Response(JSON.stringify({ error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500002' }), { status: 400 });
  }) as typeof fetch;
  await assert.rejects(cachedRedisProbe(process.env, 1_000));
  assert.equal(commands.length, 1);
  assert.notEqual(commands[0]![0], 'PING');
  await assert.rejects(cachedRedisProbe(process.env, 2_000));
  assert.equal(commands.length, 1, 'breaker open: no further command');
  forgetRedisProbe();
  resetRedisBreakers();
  globalThis.fetch = (async () => Response.json({ result: 0 })) as typeof fetch;
  await cachedRedisProbe(process.env, 3_000);
});

test('R-06: a malformed rate-limit script reply trips the breaker: one Redis command for 20 requests, logged at error level once', async () => {
  let calls = 0;
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (line: unknown) => { errors.push(String(line)); };
  globalThis.fetch = (async () => { calls++; return Response.json({ result: ['x', 'y'] }); }) as typeof fetch;
  try {
    for (let i = 0; i < 20; i++) await rateLimitShared(request(), { limit: 5, windowMs: 60_000, bucket: 'redisopt-bad-reply', readFallback: true });
  } finally { console.error = originalError; }
  assert.equal(calls, 1);
  assert.equal(errors.filter((line) => line.includes('redis-invalid-reply')).length, 1);
});

test('R-07: weekend-watch without Redis remembers fingerprints in the process: a second run revalidates nothing', async () => {
  const { layeredFingerprintStore, forgetWeekendWatchFingerprints } = await import('../lib/weekend-watch');
  forgetWeekendWatchFingerprints();
  const down = { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); } };
  for (const redis of [null, down]) {
    forgetWeekendWatchFingerprints();
    const store = layeredFingerprintStore(redis);
    assert.equal(await store.get('k'), null);
    await store.set('k', 'abc:1');
    assert.equal(await store.get('k'), 'abc:1');
  }
  // A healthy Redis value wins and is remembered for later outages.
  forgetWeekendWatchFingerprints();
  let healthy = true;
  const flaky = { get: async () => { if (!healthy) throw new Error('down'); return 'shared:1'; }, set: async () => {} };
  const store = layeredFingerprintStore(flaky);
  assert.equal(await store.get('k'), 'shared:1');
  healthy = false;
  assert.equal(await store.get('k'), 'shared:1');
});

test('R-08: the admin shared-store status reflects the breaker, not just the env vars', async () => {
  const { redisAvailability } = await import('../lib/health');
  const env = { UPSTASH_REDIS_REST_URL: 'https://fixture-db.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' };
  assert.deepEqual(redisAvailability({}), { state: 'not-configured', kind: null });
  globalThis.fetch = (async () => Response.json({ result: 0 })) as typeof fetch;
  assert.equal(redisAvailability(env).state, 'shared');
  useRedis('quota');
  await rateLimitShared(request(), { limit: 5, windowMs: 60_000, bucket: 'redisopt-admin-status', readFallback: true });
  assert.deepEqual(redisAvailability(env), { state: 'unavailable', kind: 'redis-quota' });
});
