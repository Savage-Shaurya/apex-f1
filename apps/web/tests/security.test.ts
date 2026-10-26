import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { NextRequest } from 'next/server';
import { NodeNextRequest } from 'next/dist/server/base-http/node';
import { addRequestMeta } from 'next/dist/server/request-meta';
import { NextRequestAdapter } from 'next/dist/server/web/spec-extension/adapters/next-request';
import { adminUnauthorized, isAuthorizedAdminRequest, isLocalDev } from '../lib/admin-auth';
import { isAuthorizedCronRequest } from '../lib/cron-auth';
import { validateJsonMutationRequest } from '../lib/mutation-guard';
import {
  captureClient, captureServer, CONSENT_STORAGE_KEY, hasAnalyticsConsent,
  saveConsent, setAnalyticsConsent, subscribeToConsentChanges,
} from '../lib/analytics';
import { proxy } from '../proxy';

const envKeys = ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'ADMIN_PASSWORD', 'ADMIN_USERS_JSON', 'ADMIN_LOCAL_DEV_BYPASS', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'CRON_SECRET', 'POSTHOG_KEY', 'POSTHOG_HOST'];
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const consent = (analytics: boolean) => ({ analytics, marketing: false, ts: '2026-09-30T08:00:00.000Z' });
let browser: ConsentWindow | undefined;

function setEnv(values: Record<string, string | undefined>) {
  for (const key of envKeys) delete process.env[key];
  process.env.UPSTASH_REDIS_REST_URL = 'https://security-fixture.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-security-token';
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}
function restoreProperty(key: 'window' | 'fetch', descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  else Reflect.deleteProperty(globalThis, key);
}
beforeEach(() => {
  setEnv({});
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, writable: true,
    value: async (url: unknown) => {
      if (String(url) === 'https://security-fixture.upstash.io') return Response.json({ result: [1, 60_000] });
      throw new Error('Security tests must not reach the network');
    },
  });
});
afterEach(() => {
  if (browser) {
    browser.failWrite = false;
    saveConsent(consent(false)); // Reset the module's fail-closed session flag.
    browser = undefined;
  }
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  restoreProperty('window', originalWindow);
  restoreProperty('fetch', originalFetch);
});
const basic = (password: string, username = 'apex') => 'Basic ' + Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
const req = (headers: Record<string, string> = {}, url = 'https://apex.example/api/articles') => new NextRequest(url, { method: 'POST', headers });

test('production without admin credentials fails closed off Vercel and on every hostname', async () => {
  for (const deployment of [undefined, 'production', 'preview']) {
    setEnv({ NODE_ENV: 'production', VERCEL_ENV: deployment });
    for (const url of ['https://apex.example/admin', 'http://localhost:3000/admin']) {
      const request = req({ authorization: basic('test-password') }, url);
      assert.equal(isAuthorizedAdminRequest(request), false);
      assert.equal(isLocalDev(request), false);
      assert.equal((await proxy(request)).status, 404);
    }
  }
});

test('development bypass requires a supplied loopback request and no deployment environment', () => {
  setEnv({ NODE_ENV: 'development', ADMIN_LOCAL_DEV_BYPASS: 'true' });
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(isLocalDev(req({}, `http://${host}:3000/admin`)), true);
  }
  assert.equal(isLocalDev(), false);
  assert.equal(isLocalDev({ url: 'malformed URL' } as Request), false);
  assert.equal(isLocalDev(req({ 'x-forwarded-host': 'localhost' }, 'https://public.example/admin')), false);
  assert.equal(isLocalDev(req({}, 'http://localhost.evil.example/admin')), false);
  for (const values of [{ NODE_ENV: 'test' }, { NODE_ENV: 'development', VERCEL_ENV: 'preview' }, { NODE_ENV: 'development', VERCEL: '1' }]) {
    setEnv(values);
    assert.equal(isLocalDev(req({}, 'http://localhost/admin')), false);
  }
});

test('configured development password always takes precedence over loopback bypass', async () => {
  setEnv({ NODE_ENV: 'development', ADMIN_PASSWORD: 'test-password' });
  const local = 'http://127.0.0.1:3000/admin';
  assert.equal(isLocalDev(req({}, local)), false);
  assert.equal((await proxy(req({}, local))).status, 401);
  assert.equal((await proxy(req({ authorization: basic('wrong-password') }, local))).status, 401);
  assert.equal((await proxy(req({ authorization: basic('test-password') }, local))).headers.get('x-middleware-next'), '1');
});

test('Basic auth accepts ASCII and UTF-8 credentials while wrong user, password or scheme fail', async () => {
  for (const password of ['test:ASCII-password', 'test-測試-🔒-é']) {
    setEnv({ NODE_ENV: 'test', ADMIN_PASSWORD: password });
    assert.equal(isAuthorizedAdminRequest(req({ authorization: basic(password) })), true);
    for (const authorization of [basic(password, 'other'), basic(password + 'x'), 'Bearer test', 'Basic !!!!']) {
      assert.equal(isAuthorizedAdminRequest(req({ authorization })), false);
    }
  }
  const response = adminUnauthorized();
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate') ?? '', /Basic .*charset="UTF-8"/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), 'Authentication required');
});

test('real Proxy returns uncached 404/401 or permits the authenticated request', async () => {
  setEnv({ NODE_ENV: 'production' });
  const hidden = await proxy(req());
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get('cache-control'), 'private, no-store');
  setEnv({ NODE_ENV: 'test', ADMIN_PASSWORD: 'test-password' });
  const challenge = await proxy(req());
  assert.equal(challenge.status, 401);
  assert.equal(challenge.headers.get('cache-control'), 'private, no-store');
  assert.equal((await proxy(req({ authorization: basic('test-password') }))).headers.get('x-middleware-next'), '1');
});

test('JSON mutation boundary rejects simple/form content types before handling the body', async () => {
  for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=test', 'application/+json']) {
    const response = validateJsonMutationRequest(req(type ? { 'content-type': type } : {}));
    assert.equal(response?.status, 415);
    assert.equal(response?.headers.get('cache-control'), 'no-store');
    assert.equal((await response!.json()).error, 'Content-Type must be application/json');
  }
});

test('foreign, opaque and malformed origins or contradictory browser metadata are forbidden', () => {
  for (const origin of ['https://foreign.example', 'null', 'malformed', 'https://apex.example/path', 'https://apex.example/', 'https://apex.example:443']) {
    assert.equal(validateJsonMutationRequest(req({ 'content-type': 'application/json', origin }))?.status, 403);
  }
  for (const site of ['same-site', 'cross-site', 'none', 'invalid']) {
    assert.equal(validateJsonMutationRequest(req({ 'content-type': 'application/json', origin: 'https://apex.example', 'sec-fetch-site': site }))?.status, 403);
    assert.equal(validateJsonMutationRequest(req({ 'content-type': 'application/json', 'sec-fetch-site': site }))?.status, 403);
  }
});

test('canonical same-origin JSON and structured JSON pass; authenticated originless CLI passes both gates', () => {
  for (const type of ['application/json', 'APPLICATION/JSON; charset=UTF-8', 'application/problem+json', 'application/vnd.api+json']) {
    assert.equal(validateJsonMutationRequest(req({ 'content-type': type, origin: 'https://apex.example', 'sec-fetch-site': 'same-origin' })), null);
  }
  setEnv({ NODE_ENV: 'test', ADMIN_PASSWORD: 'test-cli-password' });
  const cli = req({ 'content-type': 'application/json', authorization: basic('test-cli-password') });
  assert.equal(isAuthorizedAdminRequest(cli), true);
  assert.equal(validateJsonMutationRequest(cli), null);
  assert.equal(isAuthorizedAdminRequest(req({ 'content-type': 'application/json' })), false);
});

function nodeAdapterRequest(headers: Record<string, string>) {
  // An unconnected socket reproduces Next's Node adapter without a listener or network.
  const socket = new Socket();
  const incoming = new IncomingMessage(socket);
  incoming.method = 'POST';
  incoming.url = '/api/articles';
  incoming.headers = { 'content-type': 'application/json', host: '127.0.0.1:3101', ...headers };
  incoming.push('{}');
  incoming.push(null);
  addRequestMeta(incoming, 'initURL', 'http://localhost:3101/api/articles');
  const request = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
  return {
    request,
    async close() {
      try { await request.body?.cancel(); }
      finally { incoming.destroy(); socket.destroy(); }
    },
  };
}

test('actual Next Node URL reconstruction authorizes the direct Host and rejects the internal hostname', async () => {
  for (const [origin, expectedStatus] of [['http://127.0.0.1:3101', undefined], ['http://localhost:3101', 403]] as const) {
    const adapted = nodeAdapterRequest({ origin, 'sec-fetch-site': 'same-origin' });
    try {
      assert.equal(adapted.request.url, 'http://localhost:3101/api/articles');
      assert.equal(adapted.request.headers.get('host'), '127.0.0.1:3101');
      assert.equal(validateJsonMutationRequest(adapted.request)?.status, expectedStatus);
    } finally { await adapted.close(); }
  }
});

test('actual Node reconstruction cannot grant development bypass to a remote or malformed direct Host', async () => {
  setEnv({ NODE_ENV: 'development', ADMIN_LOCAL_DEV_BYPASS: 'true' });
  for (const [host, permitted] of [
    ['public.example:3101', false], ['', false], ['user@localhost:3101', false],
    ['localhost:', false], ['localhost:3101/path', false], ['localhost:99999', false],
    ['127.0.0.1:3101', true], ['localhost:3101', true], ['[::1]:3101', true],
  ] as const) {
    const adapted = nodeAdapterRequest({ host, 'x-forwarded-host': 'localhost:3101' });
    try {
      assert.equal(adapted.request.url, 'http://localhost:3101/api/articles');
      assert.equal(isLocalDev(adapted.request), permitted, `Direct Host: ${host}`);
      const response = await proxy(adapted.request);
      assert.equal(response.status, permitted ? 200 : 404);
      if (permitted) assert.equal(response.headers.get('x-middleware-next'), '1');
    } finally { await adapted.close(); }
  }
});

test('spoofed forwarding headers cannot replace the direct Host or request protocol', async () => {
  for (const [origin, expectedStatus] of [['http://foreign.example', 403], ['https://127.0.0.1:3101', 403], ['http://127.0.0.1:3101', undefined]] as const) {
    const adapted = nodeAdapterRequest({
      origin, 'sec-fetch-site': 'same-origin',
      'x-forwarded-host': 'foreign.example', 'x-forwarded-proto': 'https',
      forwarded: 'host=foreign.example;proto=https',
    });
    try { assert.equal(validateJsonMutationRequest(adapted.request)?.status, expectedStatus); }
    finally { await adapted.close(); }
  }
});

test('invalid direct Host authorities and scheme mismatches cannot fall back to the internal URL', async () => {
  for (const host of ['', 'localhost:', 'user@localhost:3101', 'https://localhost:3101', 'localhost:3101/path', 'localhost:3101,foreign.example', 'local host:3101', 'localhost:99999', 'localhost:3101?query', 'localhost:3101#fragment']) {
    const adapted = nodeAdapterRequest({ host, origin: 'http://localhost:3101' });
    try { assert.equal(validateJsonMutationRequest(adapted.request)?.status, 403, `Invalid authority: ${host}`); }
    finally { await adapted.close(); }
  }
  const adapted = nodeAdapterRequest({ origin: 'https://127.0.0.1:3101' });
  try { assert.equal(validateJsonMutationRequest(adapted.request)?.status, 403); }
  finally { await adapted.close(); }
});

test('cron auth fails closed without a secret in all modes and ignores forged scheduler hints', () => {
  for (const nodeEnv of ['production', 'test', 'development']) {
    for (const secret of [undefined, '', 'test-cron-secret']) {
      setEnv({ NODE_ENV: nodeEnv, CRON_SECRET: secret });
      assert.equal(isAuthorizedCronRequest(req({ 'x-vercel-cron': '1', 'x-vercel-cron-schedule': '* * * * *' })), false);
      assert.equal(isAuthorizedCronRequest(req({ authorization: 'Bearer wrong-secret', 'x-vercel-cron': '1' })), false);
      assert.equal(isAuthorizedCronRequest(req({ authorization: 'Bearer test-cron-secret' })), secret === 'test-cron-secret');
    }
  }
});

class ConsentWindow extends EventTarget {
  stored = new Map<string, string>();
  failWrite = false;
  optedOut = true;
  captures = 0;
  calls: string[] = [];
  localStorage = {
    getItem: (key: string) => this.stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (this.failWrite) throw new Error('Storage unavailable');
      this.stored.set(key, value);
    },
  };
  posthog = {
    capture: () => { this.captures++; },
    has_opted_out_capturing: () => this.optedOut,
    opt_in_capturing: () => { this.optedOut = false; },
    opt_out_capturing: () => { this.optedOut = true; this.calls.push('opt-out'); },
  };
}

test('withdrawal immediately disables SDK even with a broken status probe and failed storage', () => {
  browser = new ConsentWindow();
  const fake = browser;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake });
  assert.equal(saveConsent(consent(true)), true);
  captureClient('pageview');
  assert.equal(fake.captures, 1);
  fake.posthog.has_opted_out_capturing = () => { throw new Error('SDK status failure'); };
  const unsubscribe = subscribeToConsentChanges(() => fake.calls.push('listener'));
  try {
    assert.equal(saveConsent(consent(false)), true);
    assert.equal(fake.calls[0], 'opt-out', 'SDK withdrawal must precede the preference listener');
    assert.equal(fake.calls.at(-1), 'listener');
    assert.equal(fake.optedOut, true);
    assert.equal(hasAnalyticsConsent(), false);
    fake.posthog.has_opted_out_capturing = () => fake.optedOut;
    assert.equal(saveConsent(consent(true)), true);
    fake.failWrite = true;
    assert.equal(saveConsent(consent(false)), false);
    assert.equal(JSON.parse(fake.stored.get(CONSENT_STORAGE_KEY)!).analytics, true, 'Storage still holds the old grant');
    assert.equal(hasAnalyticsConsent(), false, 'Failed withdrawal must override the old grant');
    assert.equal(fake.optedOut, true);
    captureClient('pageview');
    assert.equal(fake.captures, 1);
    assert.doesNotThrow(() => setAnalyticsConsent(false));
  } finally { unsubscribe(); }
});

test('server analytics key alone cannot capture without strict explicit visitor consent', async () => {
  setEnv({ POSTHOG_KEY: 'test-fake-key', POSTHOG_HOST: 'https://test.invalid' });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  await captureServer('pageview');
  await captureServer('pageview', {}, { analyticsConsent: false });
  await captureServer('pageview', {}, { analyticsConsent: 'true' as unknown as boolean });
  assert.equal(calls, 0);
  await captureServer('pageview', {}, { analyticsConsent: true });
  assert.equal(calls, 1);
});
