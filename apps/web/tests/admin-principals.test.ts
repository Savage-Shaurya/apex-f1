import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NextRequest } from 'next/server';
import { ADMIN_CAPABILITIES, LEGACY_ADMIN_CAPABILITIES, authorizeAdminRequest, configuredAdminUsers, hashAdminPassword, hasAdminCapability, isLocalDev } from '../lib/admin-auth';
import { config, proxy } from '../proxy';

const keys = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'ADMIN_PASSWORD', 'ADMIN_USERS_JSON', 'ADMIN_LOCAL_DEV_BYPASS', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
const originals = new Map(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const password = 'synthetic-administrator-password-20261004';
const hash = await hashAdminPassword(password);
let counters: Map<string, number>;
let calls = 0;
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', UPSTASH_REDIS_REST_URL: 'https://admin-fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic-admin-quota-token' });
  counters = new Map(); calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://admin-fixture.upstash.io', 'Tests never reach a real network');
    assert.equal(init?.redirect, 'error');
    const command: unknown[] = JSON.parse(String(init?.body));
    const key = String(command[3]);
    const limit = Number(command[4]);
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count); calls++;
    return Response.json({ result: [Math.min(count, limit + 1), Number(command[5])] });
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of originals) {
    if (value === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: value });
  }
});
function users(capabilities: string[] = ['read']) {
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'reader', passwordHash: hash, capabilities }, { username: 'owner', passwordHash: hash, capabilities: ADMIN_CAPABILITIES }]);
}
function request(username = 'reader', secret = password, ip = '192.0.2.10') {
  return new NextRequest('https://apex.example/api/articles', { headers: { authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`, 'x-vercel-forwarded-for': ip } });
}

test('named administrators have individually identified and bounded capabilities', async () => {
  users();
  const reader = await authorizeAdminRequest(request(), 'read');
  assert.equal(reader.response, null);
  assert.equal(reader.principal?.username, 'reader');
  assert.equal(reader.principal?.legacy, false);
  for (const capability of ['write', 'publish', 'image', 'newsletter-reconcile'] as const) {
    assert.equal((await authorizeAdminRequest(request(), capability)).response?.status, 403);
  }
  const owner = await authorizeAdminRequest(request('owner'), 'publish');
  assert.equal(owner.principal?.username, 'owner');
  assert.ok(owner.principal && hasAdminCapability(owner.principal, 'publish'));
  assert.equal((await authorizeAdminRequest(request('reader', 'wrong-password'), 'read')).response?.status, 401);
});

test('legacy owner credentials coexist with individually scoped principals', async () => {
  users(); process.env.ADMIN_PASSWORD = 'legacy-owner-test-password';
  const owner = await authorizeAdminRequest(request('apex', process.env.ADMIN_PASSWORD), 'image');
  assert.equal(owner.principal?.legacy, true);
  assert.deepEqual(owner.principal?.capabilities, LEGACY_ADMIN_CAPABILITIES);
  assert.equal((await authorizeAdminRequest(request('apex', process.env.ADMIN_PASSWORD), 'newsletter-reconcile')).response?.status, 403);
  assert.equal((await authorizeAdminRequest(request(), 'publish')).response?.status, 403);
});

test('quota is authoritative before checking either correct or incorrect credentials', async () => {
  process.env.ADMIN_PASSWORD = password;
  const guesses = await Promise.all(Array.from({ length: 130 }, () => authorizeAdminRequest(request('apex', 'wrong-password'))));
  assert.equal(guesses.filter(result => result.response?.status === 401).length, 120);
  assert.equal(guesses.filter(result => result.response?.status === 429).length, 10);
  assert.equal((await authorizeAdminRequest(request('apex', password))).response?.status, 429, 'Exhausted callers cannot test a guessed correct password');
  assert.equal(calls, 131);
  assert.equal((await authorizeAdminRequest(request('apex', password, '192.0.2.11'))).response?.status, 429, 'Undeployed tests cannot trust caller-supplied Vercel forwarded headers');
});

test('missing or failed shared authentication storage fails closed in deployed processes', async () => {
  users(); delete process.env.UPSTASH_REDIS_REST_TOKEN;
  assert.equal((await authorizeAdminRequest(request(), 'read')).response?.status, 503);
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-token';
  globalThis.fetch = async () => { throw new Error('synthetic-store-outage'); };
  assert.equal((await authorizeAdminRequest(request(), 'read')).response?.status, 503);
});

test('privilege removal and password rotation invalidate successful credential caches', async () => {
  users(['read', 'publish']);
  assert.equal((await authorizeAdminRequest(request(), 'publish')).response, null);
  users(['read']);
  assert.equal((await authorizeAdminRequest(request(), 'publish')).response?.status, 403);
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'reader', passwordHash: await hashAdminPassword('rotated-synthetic-password-20261004'), capabilities: ['read'] }]);
  assert.equal((await authorizeAdminRequest(request())).response?.status, 401);
  assert.equal((await authorizeAdminRequest(request('reader', 'rotated-synthetic-password-20261004'))).response, null);
});

test('returned principal arrays cannot alter cached privileges', async () => {
  users();
  const first = await authorizeAdminRequest(request(), 'read');
  assert.ok(first.principal);
  (first.principal.capabilities as string[]).push('publish');
  assert.equal((await authorizeAdminRequest(request(), 'publish')).response?.status, 403);
});

test('invalid named configuration never silently falls back to legacy owner access', async () => {
  process.env.ADMIN_PASSWORD = password;
  for (const value of ['not JSON', '{}', '[]', JSON.stringify([{ username: 'reader', passwordHash: hash, capabilities: ['superuser'] }]), JSON.stringify([{ username: 'apex', passwordHash: hash, capabilities: ['read'] }]), JSON.stringify(Array.from({ length: 33 }, (_, i) => ({ username: `user-${i}`, passwordHash: hash, capabilities: ['read'] })))]) {
    process.env.ADMIN_USERS_JSON = value;
    assert.throws(configuredAdminUsers);
    const result = await authorizeAdminRequest(request('apex', password));
    assert.equal(result.response?.status, 503);
    assert.equal((await result.response!.text()).includes(password), false);
  }
});

test('administrative responses are private and public Host spoofing does not grant default development access', async () => {
  users();
  const permitted = await proxy(new NextRequest('https://apex.example/admin', { headers: request().headers }));
  assert.equal(permitted.headers.get('x-middleware-next'), '1');
  assert.equal(permitted.headers.get('cache-control'), 'private, no-store');
  assert.match(permitted.headers.get('vary')!, /Authorization/);
  delete process.env.ADMIN_USERS_JSON; delete process.env.VERCEL; Object.assign(process.env, { NODE_ENV: 'development' });
  const spoofed = new NextRequest('http://public.invalid/admin', { headers: { host: 'localhost:3000' } });
  assert.equal(isLocalDev(spoofed), false);
  assert.equal((await proxy(spoofed)).status, 404);
});

test('newsletter recovery is an explicit named privilege with no legacy or ordinary editor grant', async () => {
  users([...LEGACY_ADMIN_CAPABILITIES]);
  assert.equal((await authorizeAdminRequest(request(), 'newsletter-reconcile')).response?.status, 403);
  process.env.ADMIN_PASSWORD = 'legacy-owner-test-password';
  assert.equal((await authorizeAdminRequest(request('apex', process.env.ADMIN_PASSWORD), 'newsletter-reconcile')).response?.status, 403);
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'recovery', passwordHash: hash, capabilities: ['newsletter-reconcile'] }]);
  const recovery = await authorizeAdminRequest(request('recovery'), 'newsletter-reconcile');
  assert.equal(recovery.response, null);
  assert.equal(recovery.principal?.legacy, false);
  assert.deepEqual(recovery.principal?.capabilities, ['newsletter-reconcile']);
  assert.equal((await authorizeAdminRequest(request('recovery'), 'read')).response?.status, 403, 'Recovery permission does not grant editorial access');
});

test('newsletter privilege removal invalidates a cached successful operator immediately', async () => {
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'recovery', passwordHash: hash, capabilities: ['read', 'newsletter-reconcile'] }]);
  assert.equal((await authorizeAdminRequest(request('recovery'), 'newsletter-reconcile')).response, null);
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'recovery', passwordHash: hash, capabilities: ['read'] }]);
  assert.equal((await authorizeAdminRequest(request('recovery'), 'newsletter-reconcile')).response?.status, 403);
  assert.equal((await authorizeAdminRequest(request('recovery'), 'read')).response, null);
});

test('newsletter edition list, detail and reconciliation all have a matching privileged proxy gate', async () => {
  users();
  assert.ok(config.matcher.includes('/api/newsletter/editions'));
  assert.ok(config.matcher.includes('/api/newsletter/editions/:path*'));
  const paths = ['/api/newsletter/editions', '/api/newsletter/editions/weekly-2026-10-04', '/api/newsletter/editions/weekly-2026-10-04/reconcile'];
  for (const path of paths) {
    for (const method of ['GET', 'HEAD', 'POST']) {
      const denied = await proxy(new NextRequest(`https://apex.example${path}`, { method, headers: request().headers }));
      assert.equal(denied.status, 403);
      assert.equal(denied.headers.get('cache-control'), 'private, no-store');
      assert.equal(denied.headers.get('vary'), 'Authorization, Cookie');
      const permitted = await proxy(new NextRequest(`https://apex.example${path}`, { method, headers: request('owner').headers }));
      assert.equal(permitted.headers.get('x-middleware-next'), '1');
      assert.equal(permitted.headers.get('cache-control'), 'private, no-store');
      assert.equal(permitted.headers.get('vary'), 'Authorization, Cookie');
    }
  }
});

test('opt-in local development bypass cannot acquire newsletter recovery permission', async () => {
  delete process.env.VERCEL;
  Object.assign(process.env, { NODE_ENV: 'development', ADMIN_LOCAL_DEV_BYPASS: 'true' });
  const local = new NextRequest('http://127.0.0.1:3433/api/newsletter/editions');
  assert.equal(isLocalDev(local), true);
  const denied = await authorizeAdminRequest(local, 'newsletter-reconcile');
  assert.equal(denied.response?.status, 403);
  assert.equal(denied.response?.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await authorizeAdminRequest(local, 'read')).principal?.capabilities, LEGACY_ADMIN_CAPABILITIES);
  assert.equal((await proxy(local)).status, 403);
});

test('authentication quota exhaustion and storage failure retain private response boundaries', async () => {
  users();
  globalThis.fetch = async () => { throw new Error('synthetic-store-outage'); };
  const failed = await authorizeAdminRequest(request(), 'newsletter-reconcile');
  assert.equal(failed.response?.status, 503);
  assert.equal(failed.response?.headers.get('cache-control'), 'private, no-store');
  assert.equal(failed.response?.headers.get('vary'), 'Authorization, Cookie');
  assert.equal(failed.response?.headers.get('retry-after'), '30');
  globalThis.fetch = async () => Response.json({ result: [121, 60_000] });
  const exhausted = await authorizeAdminRequest(request(), 'newsletter-reconcile');
  assert.equal(exhausted.response?.status, 429);
  assert.equal(exhausted.response?.headers.get('cache-control'), 'private, no-store');
  assert.equal(exhausted.response?.headers.get('vary'), 'Authorization, Cookie');
  assert.equal(exhausted.response?.headers.get('retry-after'), '60');
});
