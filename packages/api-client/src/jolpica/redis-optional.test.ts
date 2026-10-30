/**
 * Redis is optional for Jolpica reads (incident 2026-10-31). Upstash's quota
 * reply (HTTP 400 "max requests limit exceeded") failed every read at the
 * shared admission step, then failed the production build at
 * /teams/[slug]/history. Every Upstash failure mode must now leave the read on
 * process-local pacing, `next build` must not use the shared admission or
 * write last-good copies at all, and the command count per read is bounded.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JolpicaRequestControl } from './request-control';
import { createJolpicaSharedAdmission, invalidateSharedJolpicaChampionships } from './shared-admission';
import { createRedisJolpicaLastGoodStore } from './last-good';
import { REDIS_FAILURES, type RedisFailureMode } from '../redis-failure-fixtures';
import { redisBreakerOpen, resetRedisBreakers } from '../redis-guard';

const CONFIG = { url: 'https://fixture-db.upstash.io', token: 'fixture-token' };
const ENV = { APEX_REDIS_SCOPE: 'redisopt' };
const BASE = 'https://api.jolpi.ca/ergast/f1';
const history = `${BASE}/constructors/ferrari/constructorStandings.json?limit=100&offset=0`;
const schedule = `${BASE}/2026.json?limit=100&offset=0`;
const MODES = Object.keys(REDIS_FAILURES) as RedisFailureMode[];

const originalWarn = console.warn;
beforeEach(() => { resetRedisBreakers(); console.warn = () => {}; });
afterEach(() => { console.warn = originalWarn; });

/** A fake Upstash answering one failure mode (or a healthy admit), counting every command. */
function upstash(mode: RedisFailureMode | 'healthy') {
  const commands: string[][] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as string[];
    commands.push(command);
    if (mode !== 'healthy') return REDIS_FAILURES[mode](input, init);
    if (command[0] === 'EVAL') return Response.json({ result: command[1]!.includes("redis.call('TIME')") ? [1, 0, 35_000] : 1 });
    if (command[0] === 'GET') return Response.json({ result: null });
    return Response.json({ result: 'OK' });
  }) as typeof fetch;
  return { impl, commands };
}
function control(redis: ReturnType<typeof upstash>, building = false) {
  return new JolpicaRequestControl({
    sharedAdmission: createJolpicaSharedAdmission(CONFIG, { fetch: redis.impl, env: ENV }),
    lastGood: createRedisJolpicaLastGoodStore(CONFIG, { fetch: redis.impl, env: ENV, timeoutMs: 200 }),
    buildPhase: () => building,
  });
}

for (const mode of MODES) {
  test(`Upstash ${mode}: a Jolpica page read still reaches Jolpica (process-local pacing) and returns real data`, async () => {
    const redis = upstash(mode);
    const reads = control(redis);
    let physical = 0;
    const value = await reads.readThrough(schedule, 300, { timeoutMs: 6_000 }, async () => { physical++; return { races: 24 }; });
    assert.deepEqual(value, { races: 24 });
    assert.equal(physical, 1);
    // A second key on the same instance: if the breaker is open, no Redis command at all.
    const before = redis.commands.length;
    await reads.readThrough(history, 300, { timeoutMs: 6_000 }, async () => ({ standings: [] }));
    if (redisBreakerOpen(redis.impl)) assert.equal(redis.commands.length, before, 'open breaker: no Redis command');
  });

  test(`Upstash ${mode} during next build: the read succeeds with zero Redis commands (no admission, no last-good write)`, async () => {
    const redis = upstash(mode);
    const reads = control(redis, true);
    // The build budget (transport + 90 s queue allowance) is longer than the 35 s admission lease.
    const value = await reads.readThrough(history, 300, { timeoutMs: 120_000 }, async () => ({ standings: [{ season: '2025' }] }));
    assert.deepEqual(value, { standings: [{ season: '2025' }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(redis.commands.length, 0, redis.commands.map((c) => c[0]).join(','));
  });
}

test('a healthy Upstash during next build is not used either, and a 120 s build read is not refused by the 35 s lease', async () => {
  const redis = upstash('healthy');
  const reads = control(redis, true);
  assert.deepEqual(await reads.readThrough(history, 300, { timeoutMs: 120_000 }, async () => ({ ok: 1 })), { ok: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(redis.commands.length, 0);
});

test('the championship epoch bump is best effort: an Upstash quota reply never fails a season refresh', async () => {
  const redis = upstash('quota');
  await invalidateSharedJolpicaChampionships(2025, CONFIG, { fetch: redis.impl, env: ENV, finished: true });
  await invalidateSharedJolpicaChampionships(2025, null, { finished: true });
});

test('last-good store: every failure mode reads as a miss and a write never throws', async () => {
  for (const mode of MODES) {
    resetRedisBreakers();
    const redis = upstash(mode);
    const store = createRedisJolpicaLastGoodStore(CONFIG, { fetch: redis.impl, env: ENV, timeoutMs: 100 });
    assert.equal(await store.read(schedule), null, mode);
    await store.write(schedule, { storedAt: Date.now(), value: { races: 1 } });
  }
});

/**
 * Command budget (documented in DEPLOY.md "Redis usage budget"): a warm
 * instance serving one key 100 times spends at most 3 commands (one reserve,
 * one complete, one last-good write); the same key re-read after its TTL
 * within the hour does not rewrite the last-good copy.
 */
test('command budget: 100 page reads of one key on a warm instance cost ≤ 3 Redis commands', async () => {
  const redis = upstash('healthy');
  const state = { now: 1_000_000 };
  const reads = new JolpicaRequestControl({
    now: () => state.now, sleep: async (ms) => { state.now += ms; },
    sharedAdmission: createJolpicaSharedAdmission(CONFIG, { fetch: redis.impl, env: ENV, monotonic: () => state.now }),
    lastGood: createRedisJolpicaLastGoodStore(CONFIG, { fetch: redis.impl, env: ENV }),
    buildPhase: () => false,
  });
  for (let i = 0; i < 100; i++) await reads.readThrough(schedule, 300, { timeoutMs: 6_000 }, async () => ({ races: 24 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(redis.commands.length <= 3, `${redis.commands.length} commands`);
});
