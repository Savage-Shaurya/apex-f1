import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { hashAdminPassword, authorizeAdminRequest, isAuthorizedAdminRequest } from '../lib/admin-auth';
import { adminSessionConfiguration, adminSessionCookie, adminSessionOriginAllowed, adminSessionSetCookie, adminTotpCode, matchingAdminTotpCounter } from '../lib/admin-session';
import { loginAdmin, logoutAdmin, inspectAdminSession } from '../lib/admin-session-handler';
import { proxy } from '../proxy';
import { NextRequest } from 'next/server';

const keys = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'ADMIN_USERS_JSON', 'ADMIN_PASSWORD', 'ADMIN_LOCAL_DEV_BYPASS', 'ADMIN_SESSION_SECRET', 'ADMIN_MFA_SECRETS_JSON', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DISTRIBUTED_RATE_LIMIT_REQUIRED'];
const original = new Map(keys.map(key => [key, process.env[key]]));
const originalFetch = fetch;
const password = 'isolated-session-test-password-20261004';
const hash = await hashAdminPassword(password);
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const rotatedFactor = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let now = Date.now();
let rows: Map<string, string>;
let counts: Map<string, number>;
let operations: string[][];

function actors(capabilities = ['read', 'write', 'publish']) {
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'owner', passwordHash: hash, capabilities }]);
}
function fixtureFetch(): typeof fetch {
  return async (input, init) => {
    assert.equal(String(input), 'https://session-test.upstash.io', 'No real service is contacted');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.cache, 'no-store');
    const cmd: string[] = JSON.parse(String(init?.body)); operations.push(cmd);
    assert.equal(cmd[0], 'EVAL', 'Session operations never use potentially stale replica GET');
    const script = cmd[1]!, keyCount = Number(cmd[2]);
    const commandKeys = cmd.slice(3, 3 + keyCount), args = cmd.slice(3 + keyCount);
    for (const key of commandKeys.filter(key => key.startsWith('apex:admin:'))) assert.match(key, /\{auth\}/);
    let result: unknown;
    if (script === "return redis.call('GET', KEYS[1])") result = rows.get(commandKeys[0]!) ?? null;
    else if (script.includes('local function hit')) {
      // Admin login quota: per username+address bucket first, then the per-username backstop.
      const hit = (key: string, limit: number) => { const n = Math.min((counts.get(key) ?? 0) + 1, limit + 1); counts.set(key, n); return n; };
      const perAddressLimit = Number(args[0]), perAccountLimit = Number(args[1]);
      if (hit(commandKeys[0]!, perAddressLimit) > perAddressLimit) result = [0, 300_000];
      else result = hit(commandKeys[1]!, perAccountLimit) > perAccountLimit ? [0, 300_000] : [1, 300_000];
    } else if (script.includes('local limit')) {
      const limit = Number(args[0]);
      const window = Number(args[1]);
      const count = Math.min((counts.get(commandKeys[0]!) ?? 0) + 1, limit + 1);
      counts.set(commandKeys[0]!, count); result = [count, window];
    } else if (script.includes('local step')) {
      const step = Number(args[0]), current = Math.floor(now / 30_000);
      if (step < current - 1 || step > current + 1 || step <= Number(rows.get(commandKeys[0]!) ?? '-1') || rows.has(commandKeys[1]!) || (rows.get(commandKeys[2]!) ?? '') !== args[4]) result = null;
      else {
        rows.set(commandKeys[0]!, String(step));
        const old = rows.get(commandKeys[2]!);
        if (old) rows.delete(commandKeys[3]!);
        const expiresAt = now + 1_800_000;
        rows.set(commandKeys[1]!, JSON.stringify({ version: 1, username: args[1], fingerprint: args[2], createdAt: now, seenAt: now, expiresAt }));
        rows.set(commandKeys[2]!, args[3]!); result = expiresAt;
      }
    } else if (script.includes('local raw')) {
      const raw = rows.get(commandKeys[0]!);
      if (!raw) result = null;
      else {
        const record = JSON.parse(raw);
        if (record.expiresAt <= now || record.seenAt + 900_000 <= now) { rows.delete(commandKeys[0]!); result = null; }
        else { record.seenAt = now; result = JSON.stringify(record); rows.set(commandKeys[0]!, String(result)); }
      }
    } else if (script.includes('local removed')) result = rows.delete(commandKeys[0]!) ? 1 : 0;
    else throw new Error('Unexpected Redis script');
    return Response.json({ result });
  };
}
beforeEach(() => {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', ADMIN_SESSION_SECRET: Buffer.alloc(32, 42).toString('base64url'), ADMIN_MFA_SECRETS_JSON: JSON.stringify({ owner: secret }), UPSTASH_REDIS_REST_URL: 'https://session-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'private-synthetic-test-token', DISTRIBUTED_RATE_LIMIT_REQUIRED: 'true' });
  actors(); now = Date.now(); rows = new Map(); counts = new Map(); operations = [];
  globalThis.fetch = fixtureFetch();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
function request(path = '/api/admin/login', method = 'POST', body: unknown = { username: 'owner', password, otp: adminTotpCode(secret, Math.floor(now / 30_000)) }, cookie?: string, ip = '192.0.2.1'): Request {
  return new Request(`https://apex.example${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: 'https://apex.example', 'x-vercel-forwarded-for': ip, ...(cookie ? { Cookie: cookie } : {}) }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
async function login(): Promise<string> {
  const response = await loginAdmin(request()); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^__Host-apex_admin=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1800; Secure$/);
  const body = await response.json(); assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'ok']);
  assert.equal(JSON.stringify(body).includes(password), false);
  return cookie.split(';', 1)[0]!;
}
function storedSession(): [string, Record<string, unknown>] {
  const entry = [...rows.entries()].find(([key]) => key.includes(':session:'));
  assert.ok(entry); return [entry[0], JSON.parse(entry[1])];
}

test('TOTP matches all SHA-1 RFC 6238 vectors, including post-2038 counters', () => {
  for (const [seconds, expected] of [[59, '94287082'], [1_111_111_109, '07081804'], [1_111_111_111, '14050471'], [1_234_567_890, '89005924'], [2_000_000_000, '69279037'], [20_000_000_000, '65353130']] as const) assert.equal(adminTotpCode(secret, Math.floor(seconds / 30), 8), expected);
  assert.equal(matchingAdminTotpCounter(secret, 'not-an-otp'), null);
  assert.equal(matchingAdminTotpCounter(secret, adminTotpCode(secret, Math.floor(now / 30_000) - 3), now), null);
});
test('session configuration requires unique exact factors, a strong session secret and no legacy owner', () => {
  assert.equal(adminSessionConfiguration().actors.length, 1);
  for (const changes of [{ ADMIN_SESSION_SECRET: 'short' }, { ADMIN_MFA_SECRETS_JSON: '{}' }, { ADMIN_MFA_SECRETS_JSON: JSON.stringify({ owner: 'bad' }) }, { ADMIN_MFA_SECRETS_JSON: JSON.stringify({ owner: secret, extra: rotatedFactor }) }, { ADMIN_PASSWORD: password }, { UPSTASH_REDIS_REST_URL: 'http://session-test.upstash.io' }]) {
    const env = { ...process.env, ...changes }; assert.throws(() => adminSessionConfiguration(env));
  }
  assert.throws(() => adminSessionConfiguration({ ...process.env, ADMIN_USERS_JSON: JSON.stringify([{ username: 'owner', passwordHash: hash, capabilities: ['read'] }, { username: 'second', passwordHash: hash, capabilities: ['read'] }]), ADMIN_MFA_SECRETS_JSON: JSON.stringify({ owner: secret, second: secret }) }));
});
test('password-only Basic never authenticates a deployed actor and does not trigger a browser Basic prompt', async () => {
  const req = request('/api/admin/session', 'GET'); req.headers.set('Authorization', `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`);
  assert.equal(isAuthorizedAdminRequest(req), false);
  const gate = await authorizeAdminRequest(req); assert.equal(gate.response?.status, 401); assert.equal(gate.response?.headers.get('www-authenticate'), null);
});
test('successful session authenticates independent handler calls and preserves capability boundaries', async () => {
  actors(['read']); const cookie = await login();
  const read = request('/api/admin/session', 'GET', undefined, cookie);
  assert.equal((await inspectAdminSession(read)).status, 200);
  assert.equal((await authorizeAdminRequest(read, 'publish')).response?.status, 403);
  const principal = (await authorizeAdminRequest(read)).principal!; (principal.capabilities as string[]).push('publish');
  assert.equal((await authorizeAdminRequest(read, 'publish')).response?.status, 403);
  assert.ok(operations.filter(command => command[1]!.includes('local raw')).length >= 4, 'No in-process authorization cache survives cross-instance revocation');
});
test('login and logout require exact Origin and JSON before credentials or storage', async () => {
  for (const headers of [{ Origin: '' }, { Origin: 'null' }, { Origin: 'https://foreign.example' }, { Origin: 'https://apex.example/path' }, { 'sec-fetch-site': 'cross-site' }]) {
    for (const handler of [loginAdmin, logoutAdmin]) {
      const req = request(); for (const [key, value] of Object.entries(headers)) { if (!value) req.headers.delete(key); else req.headers.set(key, value); }
      assert.equal((await handler(req)).status, 403);
    }
  }
  assert.equal(operations.length, 0);
  const req = request(); req.headers.set('content-type', 'text/plain'); assert.equal((await loginAdmin(req)).status, 415);
});
test('cookie-authorized unsafe requests require Origin even when old CLI guard would accept missing headers', async () => {
  const cookie = await login();
  const req = request('/api/articles', 'POST', {}, cookie); req.headers.delete('origin');
  assert.equal((await authorizeAdminRequest(req, 'write')).response?.status, 403);
  req.headers.set('Origin', 'https://foreign.example'); assert.equal((await authorizeAdminRequest(req, 'write')).response?.status, 403);
  req.headers.set('Origin', 'https://apex.example'); assert.equal((await authorizeAdminRequest(req, 'write')).response, null);
});
test('duplicate, mixed, malformed and oversized cookies reject without choosing a credential or Basic fallback', async () => {
  const cookie = await login();
  for (const value of [`${cookie}; ${cookie}`, `${cookie}; apex_admin=${cookie.split('=')[1]}`, '__Host-apex_admin=bad', 'x'.repeat(16_385)]) {
    const req = request('/api/admin/session', 'GET', undefined, value); req.headers.set('Authorization', `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`);
    assert.equal(adminSessionCookie(req).token, null); assert.equal((await authorizeAdminRequest(req)).response?.status, 401);
  }
});
test('password and second factor must both be valid; rejected guesses create no sessions or consumed OTP', async () => {
  for (const payload of [{ username: 'owner', password: 'wrong', otp: adminTotpCode(secret, Math.floor(now / 30_000)) }, { username: 'owner', password, otp: '000000' }, { username: 'missing', password, otp: '000000' }]) assert.equal((await loginAdmin(request('/api/admin/login', 'POST', payload))).status, 401);
  assert.equal(rows.size, 0);
});
test('simultaneous login with one OTP yields at most one opaque session, and replay never creates another', async () => {
  const replies = await Promise.all([loginAdmin(request()), loginAdmin(request())]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 401]);
  assert.equal(replies.filter(reply => reply.headers.has('set-cookie')).length, 1);
  assert.equal([...rows.keys()].filter(key => key.includes(':session:')).length, 1);
  assert.equal((await loginAdmin(request())).status, 401);
});
test('R3-SEC-2: one address guessing a known username cannot lock the owner out from another address', async () => {
  for (let index = 0; index < 6; index++) {
    const req = request('/api/admin/login', 'POST', { username: 'owner', password: 'wrong', otp: '000000' }, undefined, '198.51.100.7');
    assert.equal((await loginAdmin(req)).status, index < 5 ? 401 : 429);
  }
  // The attacker's address is locked, the owner's is not.
  assert.equal((await loginAdmin(request('/api/admin/login', 'POST', undefined, undefined, '192.0.2.1'))).status, 200);
});
test('R3-SEC-2: a per-username backstop still bounds guesses spread across many addresses', async () => {
  for (let index = 0; index < 50; index++) {
    const req = request('/api/admin/login', 'POST', { username: 'owner', password: 'wrong', otp: '000000' }, undefined, `203.0.113.${index + 1}`);
    assert.equal((await loginAdmin(req)).status, 401);
  }
  const blocked = await loginAdmin(request('/api/admin/login', 'POST', { username: 'owner', password: 'wrong', otp: '000000' }, undefined, '203.0.113.200'));
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { ok: false, error: 'Too many login attempts.' });
});
test('unknown usernames allocate one bounded bucket per address plus one shared backstop', async () => {
  for (let index = 0; index < 5; index++) await loginAdmin(request('/api/admin/login', 'POST', { username: `unknown-${index}`, password: 'wrong', otp: '000000' }));
  assert.equal([...counts.keys()].filter(key => key.startsWith('apex:admin:') && key.includes(':login:')).length, 2);
});
test('password, permission, MFA, global session secret and actor removal revoke existing cookies', async () => {
  const cookie = await login(); const req = request('/api/admin/session', 'GET', undefined, cookie);
  const originalUsers = process.env.ADMIN_USERS_JSON, originalFactors = process.env.ADMIN_MFA_SECRETS_JSON, originalSecret = process.env.ADMIN_SESSION_SECRET;
  actors(['read']); assert.equal((await authorizeAdminRequest(req)).response?.status, 401); process.env.ADMIN_USERS_JSON = originalUsers;
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'owner', passwordHash: await hashAdminPassword('rotated-disposable-test-password-20261004'), capabilities: ['read', 'write', 'publish'] }]);
  assert.equal((await authorizeAdminRequest(req)).response?.status, 401); process.env.ADMIN_USERS_JSON = originalUsers;
  process.env.ADMIN_MFA_SECRETS_JSON = JSON.stringify({ owner: rotatedFactor }); assert.equal((await authorizeAdminRequest(req)).response?.status, 401); process.env.ADMIN_MFA_SECRETS_JSON = originalFactors;
  process.env.ADMIN_SESSION_SECRET = Buffer.alloc(32, 43).toString('base64url'); assert.equal((await authorizeAdminRequest(req)).response?.status, 401); process.env.ADMIN_SESSION_SECRET = originalSecret;
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'other', passwordHash: hash, capabilities: ['read'] }]); process.env.ADMIN_MFA_SECRETS_JSON = JSON.stringify({ other: secret });
  assert.equal((await authorizeAdminRequest(req)).response?.status, 401);
});
test('logout expires the cookie and immediately denies another instance; replay remains consumed', async () => {
  const cookie = await login();
  const response = await logoutAdmin(request('/api/admin/logout', 'POST', {}, cookie));
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie')!, /Max-Age=0; Secure$/);
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, cookie))).response?.status, 401);
  assert.equal((await loginAdmin(request())).status, 401, 'Logout never resets a consumed verification code');
});
test('new login rotates the active session while retaining an absolute expiry', async () => {
  const first = await login(); now += 30_000;
  const freshCode = adminTotpCode(secret, Math.floor(now / 30_000));
  const response = await loginAdmin(request('/api/admin/login', 'POST', { username: 'owner', password, otp: freshCode })); assert.equal(response.status, 200);
  const second = response.headers.get('set-cookie')!.split(';', 1)[0]!;
  assert.notEqual(first, second); assert.equal([...rows.keys()].filter(key => key.includes(':session:')).length, 1);
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, first))).response?.status, 401);
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, second))).response, null);
});
test('idle and absolute expiry cannot be extended by a retained browser cookie', async () => {
  const cookie = await login(); const [key, row] = storedSession();
  row.seenAt = now - 900_000; rows.set(key, JSON.stringify(row));
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, cookie))).response?.status, 401);
  row.seenAt = now; row.expiresAt = now; rows.set(key, JSON.stringify(row));
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, cookie))).response?.status, 401);
});
test('store outages fail closed without issuing cookies, and uncertain logout preserves retry', async () => {
  const cookie = await login();
  globalThis.fetch = async () => { throw new Error('Synthetic unavailable store'); };
  const denied = await loginAdmin(request()); assert.equal(denied.status, 503); assert.equal(denied.headers.get('set-cookie'), null);
  assert.equal((await authorizeAdminRequest(request('/api/admin/session', 'GET', undefined, cookie))).response?.status, 503);
  const logout = await logoutAdmin(request('/api/admin/logout', 'POST', {}, cookie)); assert.equal(logout.status, 503); assert.equal(logout.headers.get('set-cookie'), null);
});
test('login inputs are bounded before expensive password verification', async () => {
  for (const payload of [{ username: 'owner', password, otp: '12345' }, { username: 'owner', password, otp: '123456', unexpected: true }, { username: 'owner', password: 'x'.repeat(513), otp: '123456' }]) assert.equal((await loginAdmin(request('/api/admin/login', 'POST', payload))).status, 400);
  const req = request(); req.headers.set('content-length', '2049'); assert.equal((await loginAdmin(req)).status, 413);
  assert.equal(operations.some(command => command[1]!.includes('local n = tonumber')), false);
});
test('only exact login page bypasses the privileged proxy and unauthenticated page navigation goes to sign in', async () => {
  const loginPage = await proxy(new NextRequest('https://apex.example/admin/login')); assert.equal(loginPage.headers.get('x-middleware-next'), '1');
  const protectedPage = await proxy(new NextRequest('https://apex.example/admin/login-more')); assert.equal(protectedPage.status, 307); assert.equal(new URL(protectedPage.headers.get('location')!).pathname, '/admin/login');
  const api = await proxy(new NextRequest('https://apex.example/api/articles')); assert.equal(api.status, 401);
});
test('cookie flags and origin checks do not trust forwarded spoofing or public legacy bypass', () => {
  assert.match(adminSessionSetCookie('A'.repeat(43)), /; Secure$/);
  const req = request(); req.headers.set('origin', 'https://foreign.example'); req.headers.set('x-forwarded-host', 'foreign.example');
  assert.equal(adminSessionOriginAllowed(req), false);
  process.env.ADMIN_LOCAL_DEV_BYPASS = 'true'; assert.equal(isAuthorizedAdminRequest(req), false);
});
