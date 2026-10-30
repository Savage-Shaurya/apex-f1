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
const ENV_KEYS = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DISTRIBUTED_RATE_LIMIT_REQUIRED', 'APEX_REDIS_SCOPE'] as const;
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
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', DISTRIBUTED_RATE_LIMIT_REQUIRED: 'true',
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
  test(`rate limiter, Upstash ${mode}: reads stay open, a write stays limited in memory, admin refuses`, async () => {
    useRedis(mode);
    const read = await rateLimitShared(request(), { limit: 120, windowMs: 60_000, bucket: `redisopt-read-${mode}` });
    assert.equal(read.available, true);
    assert.equal(read.ok, true);
    assert.equal(read.store, 'local');

    // A sensitive write (newsletter/predict style) never becomes unlimited.
    const writer = request();
    const write = { limit: 3, windowMs: 60_000, bucket: `redisopt-write-${mode}` };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await rateLimitShared(writer, write));
    assert.deepEqual(results.map((r) => r.ok), [true, true, true, false, false]);
    assert.ok(results.every((r) => r.available && r.store === 'local'));
    assert.ok(results[3]!.retryAfter >= 1);

    const admin = await rateLimitShared(request(), { limit: 20, windowMs: 300_000, bucket: `redisopt-admin-${mode}`, failClosed: true });
    assert.equal(admin.available, false);
    assert.equal(admin.ok, false);
    assert.equal(admin.store, 'unavailable');
  });
}

test('rate limiter: after a quota reply the breaker keeps later requests off Redis entirely', async () => {
  useRedis('quota');
  for (let i = 0; i < 25; i++) await rateLimitShared(request(), { limit: 120, windowMs: 60_000, bucket: 'redisopt-breaker' });
  assert.equal(redisCalls, 1);
});

test('rate limiter without any Upstash configuration in production: reads open, writes limited, admin refuses', async () => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  assert.equal((await rateLimitShared(request(), { limit: 60, windowMs: 60_000, bucket: 'redisopt-noconf-read' })).ok, true);
  const writer = request();
  const write = { limit: 1, windowMs: 60_000, bucket: 'redisopt-noconf-write' };
  assert.equal((await rateLimitShared(writer, write)).ok, true);
  assert.equal((await rateLimitShared(writer, write)).ok, false);
  assert.equal((await rateLimitShared(request(), { ...write, bucket: 'redisopt-noconf-admin', failClosed: true })).available, false);
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
  await rateLimitShared(request(), { limit: 5, windowMs: 60_000, bucket: 'redisopt-count' });
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
