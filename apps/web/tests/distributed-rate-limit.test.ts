import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { resetRedisBreakers } from '../../../packages/api-client/src/redis-guard';
import { rateLimitShared, rateLimitUnavailable } from '../lib/distributed-rate-limit';
import { tooMany, type RateLimitOptions } from '../lib/rate-limit';

const ENV_KEYS = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const OPTIONS = { limit: 5, windowMs: 60_000, bucket: 'shared-test' };
/** Writes and admin (the default) refuse with 503 while Redis is unavailable (owner decision R-03, 2026-10-31). */
const CLOSED = OPTIONS;
/** Reads keep the in-memory limit while Redis is unavailable. */
const READ = { ...OPTIONS, readFallback: true };
const TOKEN = 'synthetic-upstash-token';

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://synthetic-store.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: TOKEN,
  });
  resetRedisBreakers();
  // Every test owns its HTTP fixture. An accidental real request fails loudly.
  globalThis.fetch = async () => { throw new Error('External network forbidden in limiter tests'); };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

function request(ip = '203.0.113.10') {
  return new Request('https://apex.example/api/test', {
    headers: { 'x-vercel-forwarded-for': ip },
  });
}

/**
 * Independent REST fixture with one server-owned quota per key. It does not
 * evaluate or duplicate the Lua body: the HTTP boundary must submit one EVAL,
 * and the fixture supplies ordered atomic decisions across concurrent calls.
 */
function atomicStore(serverTime: () => number = () => 100_000) {
  const entries = new Map<string, { hits: number; expires: number }>();
  const commands: unknown[][] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://synthetic-store.upstash.io');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${TOKEN}`);
    const command: unknown[] = JSON.parse(String(init?.body));
    assert.equal(command.length, 6);
    assert.equal(command[0], 'EVAL');
    assert.equal(typeof command[1], 'string');
    assert.equal(command[2], '1');
    const key = String(command[3]);
    const quota = Number(command[4]);
    const windowMs = Number(command[5]);
    commands.push(command);
    const now = serverTime();
    let entry = entries.get(key);
    if (!entry || entry.expires <= now) {
      entry = { hits: 0, expires: now + windowMs };
      entries.set(key, entry);
    }
    entry.hits += 1;
    const result = [Math.min(entry.hits, quota + 1), entry.expires - now];
    // Separate server decisions from browser response completion order.
    await Promise.resolve();
    return Response.json({ result });
  };
  return { entries, commands };
}

test('simultaneous requests share exactly one quota and one atomic HTTP operation per request', async () => {
  const store = atomicStore();
  const results = await Promise.all(Array.from({ length: 30 }, () => rateLimitShared(request(), OPTIONS)));
  assert.equal(results.filter((result) => result.ok).length, OPTIONS.limit);
  assert.equal(results.filter((result) => !result.ok).length, 25);
  assert.deepEqual(results.slice(0, 5).map((result) => result.remaining), [4, 3, 2, 1, 0]);
  assert.ok(results.every((result) => result.available && result.store === 'upstash'));
  assert.ok(results.slice(5).every((result) => result.remaining === 0 && result.retryAfter === 60));
  assert.equal(store.entries.size, 1);
  assert.equal(store.commands.length, 30);
});

test('trusted clients and route policies have independent quotas', async () => {
  const store = atomicStore();
  const buckets = [
    { ip: '203.0.113.10', opts: OPTIONS },
    { ip: '203.0.113.11', opts: OPTIONS },
    { ip: '203.0.113.10', opts: { ...OPTIONS, bucket: 'another-route' } },
  ];
  for (const { ip, opts } of buckets) {
    const results = await Promise.all(Array.from({ length: 6 }, () => rateLimitShared(request(ip), opts)));
    assert.equal(results.filter((result) => result.ok).length, 5);
  }
  assert.equal(store.entries.size, 3);
});

test('TTL decreases on repeated and denied requests; expiry opens a fresh window', async () => {
  let serverNow = 100_000;
  let localNow = 5_000;
  Date.now = () => localNow;
  atomicStore(() => serverNow);
  const opts = { ...OPTIONS, limit: 2, windowMs: 1_000 };
  const first = await rateLimitShared(request(), opts);
  assert.equal(first.resetAt, 6_000);
  serverNow += 450; localNow += 450;
  const second = await rateLimitShared(request(), opts);
  const denied = await rateLimitShared(request(), opts);
  assert.equal(second.remaining, 0);
  assert.equal(second.resetAt, 6_000);
  assert.equal(denied.ok, false);
  assert.equal(denied.resetAt, 6_000);
  assert.equal(denied.retryAfter, 1);
  serverNow += 550; localNow += 550;
  const next = await rateLimitShared(request(), opts);
  assert.equal(next.ok, true);
  assert.equal(next.remaining, 1);
  assert.equal(next.resetAt, 7_000);
});

test('untrusted proxy headers cannot manufacture separate quotas outside Vercel', async () => {
  delete process.env.VERCEL;
  atomicStore();
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => rateLimitShared(request(`203.0.113.${index}`), OPTIONS)));
  assert.equal(results.filter((result) => result.ok).length, 5);
});

// Redis is optional (incident 2026-10-31; owner decision on review R-03): while the shared
// store is missing or failing, reads keep this instance's in-memory window (same limit,
// never unlimited) and every write or admin bucket refuses with 503 "try again later".
test('missing shared config: reads keep an in-memory limit; writes and admin refuse with 503', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  for (const required of ['once'] as const) {
    for (const deployment of ['production', 'preview']) {
      process.env.VERCEL_ENV = deployment;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      const opts = { ...READ, limit: 1, bucket: `noconf-${deployment}-${required}` };
      const allowed = await rateLimitShared(request(), opts);
      const denied = await rateLimitShared(request(), opts);
      assert.equal(allowed.store, 'local'); assert.equal(allowed.ok, true); assert.equal(allowed.available, true);
      assert.equal(denied.ok, false, 'never unlimited');
      const write = await rateLimitShared(request(), { ...CLOSED, bucket: `noconf-write-${deployment}` });
      assert.equal(write.available, false);
      assert.equal(write.store, 'unavailable');
      const response = rateLimitUnavailable(write);
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /try again later/i);
    }
  }
  assert.equal(calls, 0);
});

test('undeployed local development keeps the coarse brake for every bucket, reads and writes', async () => {
  Object.assign(process.env, { NODE_ENV: 'development' });
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  for (const opts of [{ ...READ, limit: 1, bucket: 'dev-read' }, { ...CLOSED, limit: 1, bucket: 'dev-write' }]) {
    const allowed = await rateLimitShared(request(), opts);
    const denied = await rateLimitShared(request(), opts);
    assert.equal(allowed.store, 'local'); assert.equal(allowed.ok, true);
    assert.equal(denied.ok, false);
  }
});

test('a configured shared store that errors: reads use the in-memory limit (never unlimited); writes refuse with 503', async () => {
  const errors = console.error;
  console.error = () => {};
  try {
    for (const reply of [
      async () => { throw new Error('synthetic quota outage'); },
      async () => new Response('{}', { status: 503 }),
      async () => Response.json({ result: [1, 0] }),
      async () => new Response(JSON.stringify({ error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500002' }), { status: 400 }),
    ]) {
      resetRedisBreakers();
      globalThis.fetch = reply;
      const opts = { ...READ, limit: 2, bucket: `errors-${Math.random().toString(36).slice(2)}` };
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await rateLimitShared(request(), opts));
      assert.deepEqual(results.map((r) => [r.store, r.ok]), [['local', true], ['local', true], ['local', false]]);
      const write = await rateLimitShared(request(), CLOSED);
      assert.equal(write.available, false);
      assert.equal(write.ok, false);
      assert.equal(rateLimitUnavailable(write).status, 503);
    }
  } finally { console.error = errors; }
});

test('insecure URLs, private hosts, credentials, misleading domains and command paths never receive the token', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  const urls = [
    'http://synthetic-store.upstash.io', 'https://localhost', 'https://127.0.0.1',
    'https://10.0.0.1', 'https://[::1]', 'https://169.254.169.254',
    'https://upstash.io', 'https://synthetic-store.upstash.io.attacker.example',
    'https://attacker-upstash.io', 'https://user:password@synthetic-store.upstash.io',
    'https://synthetic-store.upstash.io:8443', 'https://synthetic-store.upstash.io/pipeline',
    'https://synthetic-store.upstash.io/?_token=untrusted', 'https://synthetic-store.upstash.io/#fragment',
    'not-a-url',
  ];
  for (const url of urls) {
    process.env.UPSTASH_REDIS_REST_URL = url;
    const result = await rateLimitShared(request(), CLOSED);
    assert.equal(result.available, false, url);
  }
  assert.equal(calls, 0);
});

test('missing or malformed bearer tokens are rejected before HTTP', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
  for (const token of ['', 'two words', 'token\r\nInjected: value', 'a'.repeat(4_097)]) {
    process.env.UPSTASH_REDIS_REST_TOKEN = token;
    assert.equal((await rateLimitShared(request(), CLOSED)).available, false);
  }
  assert.equal(calls, 0);
});

test('HTTP errors, store errors, broken JSON and invalid quota replies never become successful requests', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const fixtures = [
    () => new Response('{}', { status: 401 }),
    () => new Response('{}', { status: 429 }),
    () => new Response('{}', { status: 503 }),
    () => Response.json({ error: `Rejected ${TOKEN}` }),
    () => new Response('{broken-json'),
    () => Response.json({}),
    () => Response.json({ result: null }),
    () => Response.json({ result: [1] }),
    () => Response.json({ result: ['1', 60_000] }),
    () => Response.json({ result: [0, 60_000] }),
    () => Response.json({ result: [7, 60_000] }),
    () => Response.json({ result: [1, -1] }),
    () => Response.json({ result: [1, 0] }),
    () => Response.json({ result: [1, 60_001] }),
    () => Response.json({ result: [1, 1.5] }),
    () => Response.json({ result: [1, 60_000], error: 'partial failure' }),
    () => Response.json({ result: [1, 60_000], padding: 'a'.repeat(5_000) }),
  ];
  for (const fixture of fixtures) {
    resetRedisBreakers();
    globalThis.fetch = async () => fixture();
    const result = await rateLimitShared(request(), CLOSED);
    assert.equal(result.available, false);
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
  globalThis.fetch = async () => { throw new Error(`Network failed with ${TOKEN}`); };
  assert.equal((await rateLimitShared(request(), CLOSED)).available, false);
});

test('a hanging fetch is aborted and fails closed at the three-second deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  globalThis.fetch = (_input, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  };
  const pending = rateLimitShared(request(), CLOSED);
  let settled = false;
  void pending.then(() => { settled = true; });
  t.mock.timers.tick(2_999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.equal(result.available, false);
  assert.equal(signal?.aborted, true);
});

test('the same deadline covers a response body that never finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"result":')); },
    cancel() { cancelled = true; },
  }));
  const pending = rateLimitShared(request(), CLOSED);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(3_000);
  const result = await pending;
  assert.equal(result.available, false);
  assert.equal(cancelled, true);
});

test('invalid server policies throw before touching shared storage', async () => {
  const policies: RateLimitOptions[] = [
    { ...OPTIONS, limit: 0 }, { ...OPTIONS, limit: 1.5 },
    { ...OPTIONS, windowMs: 0 }, { ...OPTIONS, windowMs: 86_400_001 },
    { ...OPTIONS, bucket: 'bad bucket\n' },
  ];
  for (const opts of policies) await assert.rejects(rateLimitShared(request(), opts), /Invalid rate limit policy/);
});

test('quota exhaustion returns standard 429 headers; store failure is a generic noncacheable 503', async () => {
  globalThis.fetch = async () => Response.json({ result: [6, 1_001] });
  const quota = await rateLimitShared(request(), OPTIONS);
  const denied = tooMany(quota);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '2');
  assert.equal(denied.headers.get('x-ratelimit-limit'), '5');
  assert.equal(denied.headers.get('x-ratelimit-remaining'), '0');
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const unavailable = rateLimitUnavailable(await rateLimitShared(request(), CLOSED));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('retry-after'), '30');
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await unavailable.json(), { ok: false, error: 'Temporarily unavailable. Please try again later.' });
});

test('a subject-keyed limit counts one identity across IPs and never exposes the raw subject', async () => {
  const { rateLimitSubject } = await import('../lib/rate-limit');
  const fromA = new Request('https://apex.example/api/predict', { headers: { 'x-forwarded-for': '198.51.100.1' } });
  const fromB = new Request('https://apex.example/api/predict', { headers: { 'x-forwarded-for': '203.0.113.9' } });
  const a = rateLimitSubject(fromA, { subject: 'identity-123' });
  assert.equal(a, rateLimitSubject(fromB, { subject: 'identity-123' }));
  assert.notEqual(a, rateLimitSubject(fromA, { subject: 'identity-456' }));
  assert.ok(!a.includes('identity-123'));
  assert.match(a, /^s-[0-9a-f]{32}$/);
  assert.throws(() => rateLimitSubject(fromA, { subject: '' }), TypeError);
});
