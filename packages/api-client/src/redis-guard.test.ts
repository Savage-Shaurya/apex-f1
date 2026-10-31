/**
 * Redis is optional (incident 2026-10-31): Upstash answered every data command
 * with HTTP 400 "ERR max requests limit exceeded" and that reply failed the
 * production build. The guard classifies every Upstash failure as its own
 * kind, opens a per-process breaker and never touches the network while open.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  REDIS_BREAKER_MS,
  RedisUnavailableError,
  guardedRedisFetch,
  invalidRedisReply,
  redisBreakerOpen,
  redisBreakerState,
  redisCommandStats,
  resetRedisBreakers,
  resetRedisCommandStats,
  setRedisBreakerClock,
} from './redis-guard';
import { classifyProviderFailure, isProviderUnavailable } from './transport';
import { REDIS_FAILURES, UPSTASH_QUOTA_BODY } from './redis-failure-fixtures';



let clock = 1_000_000;
const warnings: string[] = [];
const originalWarn = console.warn;
beforeEach(() => {
  resetRedisBreakers(); resetRedisCommandStats();
  clock = 1_000_000; setRedisBreakerClock(() => clock);
  warnings.length = 0; console.warn = (line: unknown) => { warnings.push(String(line)); };
});
afterEach(() => { setRedisBreakerClock(null); console.warn = originalWarn; });

function counting(reply: (input: unknown, init?: RequestInit) => Promise<Response>) {
  const calls = { n: 0 };
  const impl = (async (input: unknown, init?: RequestInit) => { calls.n += 1; return reply(input, init); }) as typeof fetch;
  return { impl, calls };
}
const send = (fetcher: typeof fetch, timeoutMs = 50) => fetcher('https://fixture-db.upstash.io', {
  method: 'POST', headers: { authorization: 'Bearer secret-token-value' }, body: JSON.stringify(['GET', 'apex:k']), signal: AbortSignal.timeout(timeoutMs),
});

test('the exact Upstash quota reply is redis-quota: breaker opens at once for 15 min, one warning, no secrets, no further network calls', async () => {
  const { impl, calls } = counting(REDIS_FAILURES.quota);
  const guarded = guardedRedisFetch('jolpica-admission', impl);
  await assert.rejects(send(guarded), (error: unknown) => error instanceof RedisUnavailableError && error.kind === 'redis-quota' && error.status === 400);
  assert.equal(redisBreakerOpen(impl), true);
  for (let i = 0; i < 20; i++) await assert.rejects(send(guarded), (error: unknown) => error instanceof RedisUnavailableError && error.kind === 'redis-quota');
  assert.equal(calls.n, 1, 'an open breaker never calls Redis');
  assert.equal(warnings.length, 1);
  const line = JSON.parse(warnings[0]!) as Record<string, unknown>;
  assert.deepEqual(line, { event: 'redis.breaker.open', kind: 'redis-quota', consumer: 'jolpica-admission', status: 400, retryInMs: REDIS_BREAKER_MS['redis-quota'] });
  assert.doesNotMatch(warnings[0]!, /secret-token-value|upstash\.io|apex:k|500000/);
  // Half-open after the window: one probe; still over quota → open again (one more warning).
  clock += REDIS_BREAKER_MS['redis-quota'] + 1;
  await assert.rejects(send(guarded));
  assert.equal(calls.n, 2);
  assert.equal(warnings.length, 2);
});

test('401 and 403 are redis-auth and open the breaker at once; 429 is redis-quota', async () => {
  for (const [status, kind] of [[401, 'redis-auth'], [403, 'redis-auth'], [429, 'redis-quota']] as const) {
    resetRedisBreakers();
    const { impl } = counting(async () => Response.json({ error: 'no' }, { status }));
    await assert.rejects(send(guardedRedisFetch('rate-limit', impl)), (error: unknown) => error instanceof RedisUnavailableError && error.kind === kind && error.status === status);
    assert.equal(redisBreakerState(impl).kind, kind);
  }
});

for (const mode of ['server', 'timeout', 'network', 'garbage'] as const) {
  test(`transient Upstash failure (${mode}) is redis-unavailable; two in a row open the breaker for 30 s; a success in between resets`, async () => {
    let failing = true;
    const { impl, calls } = counting(async (input, init) => (failing ? REDIS_FAILURES[mode](input, init) : Response.json({ result: 'OK' })));
    const guarded = guardedRedisFetch('last-good', impl);
    await assert.rejects(send(guarded), (error: unknown) => error instanceof RedisUnavailableError && error.kind === 'redis-unavailable');
    assert.equal(redisBreakerOpen(impl), false, 'one transient failure does not open it');
    failing = false;
    assert.deepEqual(await (await send(guarded)).json(), { result: 'OK' });
    failing = true;
    await assert.rejects(send(guarded));
    assert.equal(redisBreakerOpen(impl), false, 'the success reset the count');
    await assert.rejects(send(guarded));
    assert.equal(redisBreakerOpen(impl), true);
    assert.equal(redisBreakerState(impl).kind, 'redis-unavailable');
    const before = calls.n;
    await assert.rejects(send(guarded));
    assert.equal(calls.n, before);
    clock += REDIS_BREAKER_MS['redis-unavailable'] + 1;
    failing = false;
    assert.equal((await send(guarded)).status, 200);
    assert.equal(redisBreakerOpen(impl), false);
  });
}

test('an Upstash command error (our own bad script) is handed back unchanged and never opens the breaker', async () => {
  const { impl } = counting(async () => Response.json({ error: 'ERR Error running script' }, { status: 400 }));
  const guarded = guardedRedisFetch('rate-limit', impl);
  for (let i = 0; i < 5; i++) assert.equal((await send(guarded)).status, 400);
  assert.equal(redisBreakerOpen(impl), false);
});

test('a Redis failure is its own class: never a provider outage', () => {
  for (const kind of ['redis-quota', 'redis-auth', 'redis-unavailable'] as const) {
    const error = new RedisUnavailableError(kind, 'jolpica-admission', 400);
    assert.equal(classifyProviderFailure(error), 'redis-unavailable');
    assert.equal(isProviderUnavailable(error), false);
  }
});

test('commands are counted per consumer (pipelines count every command)', async () => {
  const { impl } = counting(async () => Response.json({ result: 'OK' }));
  const guarded = guardedRedisFetch('jolpica-admission', impl);
  await send(guarded);
  await guarded('https://fixture-db.upstash.io/pipeline', { method: 'POST', body: JSON.stringify([['GET', 'a'], ['GET', 'b'], ['GET', 'c']]) }).catch(() => undefined);
  const stats = redisCommandStats();
  assert.equal(stats.commands, 4);
  assert.equal(stats.byConsumer['jolpica-admission'], 4);
});

// ---------- Independent review (docs/audit/2026-10-31/redis-review.md) ----------

/** A healthy Upstash that answers after 50 ms and honours abort, like undici. */
function slowHealthy(calls: { n: number }) {
  return (async (_input: unknown, init?: RequestInit) => {
    calls.n += 1;
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ result: 'OK' })), 50);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  }) as typeof fetch;
}

test('R-02 (E1): caller aborts (client disconnects) against a healthy Redis never open the breaker', async () => {
  setRedisBreakerClock(null);
  const calls = { n: 0 };
  const impl = slowHealthy(calls);
  const guarded = guardedRedisFetch('admin-session', impl);
  for (let i = 0; i < 5; i++) {
    const caller = new AbortController();
    const pending = guarded('https://x.upstash.io', { method: 'POST', body: '["PING"]', signal: caller.signal });
    setTimeout(() => caller.abort(), 5);
    await assert.rejects(pending, (error: unknown) => !(error instanceof RedisUnavailableError));
  }
  assert.equal(redisBreakerOpen(impl), false);
  const before = calls.n;
  assert.equal((await guardedRedisFetch('rate-limit', impl)('https://x.upstash.io', { method: 'POST', body: '["PING"]' })).status, 200);
  assert.equal(calls.n, before + 1, 'the next request reached Redis');
});

test('R-02: our own Redis deadline (TimeoutError reason) still counts as a transient failure', async () => {
  setRedisBreakerClock(null);
  const impl = slowHealthy({ n: 0 });
  const guarded = guardedRedisFetch('rate-limit', impl);
  for (let i = 0; i < 2; i++) {
    const deadline = new AbortController();
    const pending = guarded('https://x.upstash.io', { method: 'POST', body: '["PING"]', signal: deadline.signal });
    setTimeout(() => deadline.abort(new DOMException('Redis deadline', 'TimeoutError')), 5);
    await assert.rejects(pending, (error: unknown) => error instanceof RedisUnavailableError);
  }
  assert.equal(redisBreakerOpen(impl), true);
});

test('R-04 (E2): half-open: after the window exactly one of 25 concurrent calls probes Redis; success closes it', async () => {
  let quota = true;
  const calls = { n: 0 };
  const impl = (async () => {
    calls.n += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return quota ? new Response(UPSTASH_QUOTA_BODY, { status: 400 }) : Response.json({ result: 'OK' });
  }) as typeof fetch;
  const guarded = guardedRedisFetch('x', impl);
  const send1 = () => guarded('https://x.upstash.io', { method: 'POST', body: '["GET","k"]' });
  await assert.rejects(send1());
  clock += REDIS_BREAKER_MS['redis-quota'] + 1;
  await Promise.allSettled(Array.from({ length: 25 }, send1));
  assert.equal(calls.n, 2, 'one probe while still over quota');
  assert.equal(redisBreakerOpen(impl), true, 'a failed probe re-opens the breaker');
  clock += REDIS_BREAKER_MS['redis-quota'] + 1;
  quota = false;
  const results = await Promise.allSettled(Array.from({ length: 25 }, send1));
  assert.equal(calls.n, 3, 'one probe after recovery');
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(redisBreakerOpen(impl), false, 'a successful probe closes it');
  assert.equal((await send1()).status, 200);
  assert.equal(calls.n, 4);
});

test('R-06: an invalid script reply is reported loudly once per trip and opens the breaker', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (line: unknown) => { errors.push(String(line)); };
  try {
    const { impl } = counting(async () => Response.json({ result: 'OK' }));
    const first = invalidRedisReply('jolpica-admission', impl);
    invalidRedisReply('jolpica-admission', impl);
    assert.equal(first.kind, 'redis-invalid-reply');
    assert.equal(redisBreakerState(impl).kind, 'redis-invalid-reply');
    assert.equal(errors.length, 1);
    assert.deepEqual(JSON.parse(errors[0]!), { event: 'redis.breaker.open', kind: 'redis-invalid-reply', consumer: 'jolpica-admission', status: null, retryInMs: REDIS_BREAKER_MS['redis-invalid-reply'] });
  } finally { console.error = originalError; }
});
