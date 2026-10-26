import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { createPredictionIdentity, readPredictionIdentity } from '@apex/db';
import { GET, POST } from '../app/api/predict/identity/route';

const keys = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'DISTRIBUTED_RATE_LIMIT_REQUIRED', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PREDICTION_COOKIE_SECRET', 'DATABASE_URL'] as const;
const originalEnv = new Map(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const secret = 'offline-prediction-identity-fixture-at-least-32-bytes';
let quotaCalls = 0;

beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://identity-fixture.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'offline-identity-token',
    PREDICTION_COOKIE_SECRET: secret,
    DATABASE_URL: 'postgres://offline-fixture.invalid/apex',
  });
  quotaCalls = 0;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://identity-fixture.upstash.io', 'No database or provider connection is permitted');
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

function request(method: 'GET' | 'POST', { cookie, body = '{}', headers = {} }: { cookie?: string; body?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest('https://apex.example/api/predict/identity', {
    method,
    headers: { origin: 'https://apex.example', ...(cookie ? { cookie: `apex_pid=${cookie}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body } : {}),
  });
}

test('identity lookup cannot create a cookie or write picks for missing, unsigned or tampered identities', async () => {
  const signed = createPredictionIdentity(secret);
  for (const cookie of [undefined, signed.id, `${signed.token}x`]) {
    const response = await GET(request('GET', { cookie }));
    assert.equal(response.status, 428);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Cookie');
  }
  assert.equal(quotaCalls, 3);
});

test('bootstrap issues signed HttpOnly v1 identity before any save and confirmation verifies the returned cookie', async () => {
  const bootstrap = await POST(request('POST'));
  assert.equal(bootstrap.status, 200);
  const payload = await bootstrap.json();
  const setCookie = bootstrap.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  const token = decodeURIComponent(setCookie.split(';')[0]!.slice('apex_pid='.length));
  assert.equal(readPredictionIdentity(token, secret), payload.identity);
  const confirmation = await GET(request('GET', { cookie: token }));
  assert.deepEqual(await confirmation.json(), { ok: true, identity: payload.identity });
  assert.equal(confirmation.headers.get('set-cookie'), null);
});

test('existing signed v1 cookie is stable across repeated bootstrap requests', async () => {
  const signed = createPredictionIdentity(secret);
  for (let index = 0; index < 3; index++) {
    const response = await POST(request('POST', { cookie: signed.token }));
    assert.deepEqual(await response.json(), { ok: true, identity: signed.id });
    assert.match(response.headers.get('set-cookie')!, new RegExp(signed.id));
  }
});

test('bootstrap never signs a caller-selected identity or accepts a cross-origin browser request', async () => {
  const signed = createPredictionIdentity(secret);
  const selected = await POST(request('POST', { body: JSON.stringify({ identity: signed.id }) }));
  assert.equal(selected.status, 400);
  assert.equal(selected.headers.get('set-cookie'), null);
  const calls = quotaCalls;
  const cases: Record<string, string>[] = [{ origin: 'https://foreign.example' }, { 'sec-fetch-site': 'cross-site' }];
  for (const headers of cases) {
    assert.equal((await POST(request('POST', { headers }))).status, 403);
    assert.equal((await GET(request('GET', { headers }))).status, 403);
  }
  assert.equal(quotaCalls, calls);
});

test('identity setup fails closed with missing configuration or unavailable distributed quota', async () => {
  delete process.env.DATABASE_URL;
  assert.equal((await POST(request('POST'))).status, 503);
  assert.equal((await GET(request('GET'))).status, 503);
  assert.equal(quotaCalls, 0);
  process.env.DATABASE_URL = 'postgres://offline-fixture.invalid/apex';
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const response = await POST(request('POST'));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('identity setup bounds its JSON request body independently of prediction payloads', async () => {
  const response = await POST(request('POST', { body: JSON.stringify({ padding: 'a'.repeat(1_025) }) }));
  assert.equal(response.status, 413);
  assert.equal(response.headers.get('set-cookie'), null);
});
