import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { GET, POST } from '../app/api/predict/route';
import { createPredictionIdentity } from '@apex/db';

const keys = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'DISTRIBUTED_RATE_LIMIT_REQUIRED', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PREDICTION_COOKIE_SECRET', 'DATABASE_URL'] as const;
const originalEnv = new Map(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
let quotaCalls = 0;

beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://prediction-fixture.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'offline-prediction-token',
    PREDICTION_COOKIE_SECRET: 'offline-prediction-fixture-secret-minimum-32-bytes',
    // Parsing and boundary failures must never reach this deliberately unusable fixture.
    DATABASE_URL: 'postgres://offline-fixture.invalid/apex',
  });
  quotaCalls = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://prediction-fixture.upstash.io', 'No provider or database connection is allowed');
    quotaCalls++;
    return Response.json({ result: [1, 60_000] });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
});

function request(headers: Record<string, string> = {}, body: BodyInit = '{}', url = 'https://apex.example/api/predict') {
  return new Request(url, {
    method: 'POST', body,
    headers: { 'content-type': 'application/json', origin: 'https://apex.example', ...headers },
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  });
}

test('prediction rejects simple form/text submissions and cross-origin browser metadata before consuming quota', async () => {
  const cases: Record<string, string>[] = [
    { 'content-type': 'text/plain' },
    { 'content-type': 'application/x-www-form-urlencoded' },
    { origin: 'https://foreign.example' },
    { origin: 'null' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'none' },
  ];
  for (const headers of cases) {
    const response = await POST(request(headers));
    assert.equal(response.status, headers['content-type'] ? 415 : 403);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(quotaCalls, 0);
});

test('prediction authorizes the direct requested Host despite Next internal URL reconstruction', async () => {
  const accepted = await POST(request({
    host: '127.0.0.1:3101', origin: 'http://127.0.0.1:3101', 'sec-fetch-site': 'same-origin',
  }, '{}', 'http://localhost:3101/api/predict'));
  assert.equal(accepted.status, 400, 'The valid browser boundary reaches payload validation');
  assert.equal(quotaCalls, 1);
  const rejected = await POST(request({
    host: '127.0.0.1:3101', origin: 'http://localhost:3101', 'sec-fetch-site': 'same-origin',
  }, '{}', 'http://localhost:3101/api/predict'));
  assert.equal(rejected.status, 403);
  assert.equal(quotaCalls, 1);
});

test('prediction bounds declared and streamed bodies to eight KiB and validates UTF-8 JSON objects', async () => {
  assert.equal((await POST(request({ 'content-length': '8193' }))).status, 413);
  assert.equal((await POST(request({}, JSON.stringify({ padding: 'a'.repeat(8_193) })))).status, 413);
  for (const body of ['{invalid', 'null', '[]', new Uint8Array([0xff])]) {
    const response = await POST(request({}, body));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
});

test('prediction times out and cancels an unfinished upload before canonical provider checks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"season":')); },
    cancel() { cancelled = true; },
  });
  const pending = POST(request({}, body));
  // The quota fixture settles before the upload parser starts its deadline.
  for (let index = 0; index < 12; index++) await Promise.resolve();
  t.mock.timers.tick(5_000);
  const response = await pending;
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
  assert.equal(quotaCalls, 1);
});

test('valid prediction saves require a previously issued signed cookie, matching identity and stable attempt ID', async () => {
  const signed = createPredictionIdentity(process.env.PREDICTION_COOKIE_SECRET!);
  const body = JSON.stringify({ season: 2026, round: 2, raceSlug: 'fixture-race', picks: { winner: 'driver_a' }, expectedRevision: null });
  for (const cookie of [undefined, signed.id, `${signed.token}x`]) {
    const response = await POST(request(cookie ? { cookie: `apex_pid=${cookie}` } : {}, body));
    assert.equal(response.status, 428);
    assert.equal(response.headers.get('set-cookie'), null, 'Saving must never manufacture another participant');
  }
  for (const header of [undefined, '01e712a1-d29a-4b76-bf24-323bb3f2521b']) {
    const response = await POST(request({ cookie: `apex_pid=${signed.token}`, ...(header ? { 'x-apex-prediction-identity': header } : {}) }, body));
    assert.equal(response.status, 412);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const missingAttempt = await POST(request({ cookie: `apex_pid=${signed.token}`, 'x-apex-prediction-identity': signed.id }, body));
  assert.equal(missingAttempt.status, 400);
  assert.equal((await missingAttempt.json()).kind, 'attempt_required');
  assert.equal(missingAttempt.headers.get('cache-control'), 'private, no-store');
  assert.equal(missingAttempt.headers.get('vary'), 'Cookie');
});

test('private readback neither bootstraps identity nor contacts storage without signed ownership', async () => {
  const signed = createPredictionIdentity(process.env.PREDICTION_COOKIE_SECRET!);
  const missing = await GET(new Request('https://apex.example/api/predict?season=2026&round=2'));
  assert.equal(missing.status, 428);
  assert.equal(missing.headers.get('set-cookie'), null);
  const mismatch = await GET(new Request('https://apex.example/api/predict?season=2026&round=2', { headers: { cookie: `apex_pid=${signed.token}` } }));
  assert.equal(mismatch.status, 412);
  const invalid = await GET(new Request('https://apex.example/api/predict?season=2026&season=2026&round=2', {
    headers: { cookie: `apex_pid=${signed.token}`, 'x-apex-prediction-identity': signed.id },
  }));
  assert.equal(invalid.status, 400);
  assert.equal(quotaCalls, 1, 'Only the authorized but invalid query reaches quota, never a database');
});
