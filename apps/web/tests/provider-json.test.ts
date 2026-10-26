import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { fetchProviderJson } from '../lib/provider-json';

const originalFetch = globalThis.fetch;
const endpoint = 'https://provider.invalid/acknowledgement';
beforeEach(() => { globalThis.fetch = async () => { throw new Error('External requests forbidden in offline provider tests'); }; });
afterEach(() => { globalThis.fetch = originalFetch; });

test('provider acknowledgements use private uncached transport and cannot redirect bearer credentials', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), endpoint); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-token');
    return Response.json({ id: 'confirmed-1' });
  };
  assert.deepEqual(await fetchProviderJson(endpoint, { headers: { authorization: 'Bearer synthetic-token' } }, { timeoutMs: 1_000 }), { status: 200, ok: true, value: { id: 'confirmed-1' } });
});

test('provider status failures are discarded without reflecting potentially sensitive bodies', async () => {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('secret provider body')); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }), { status: 429 });
  assert.deepEqual(await fetchProviderJson(endpoint, {}, { timeoutMs: 1_000 }), { status: 429, ok: false, value: null });
  assert.equal(cancelled, true);
});
test('explicit status acknowledgements cancel bodies and preserve injected transport without requiring JSON', async () => {
  let cancelled = false;
  const fetcher: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } }), { status: 202 });
  assert.deepEqual(await fetchProviderJson(endpoint, {}, { timeoutMs: 1_000, fetcher, readBodyOnSuccess: false }), { status: 202, ok: true, value: null });
  assert.equal(cancelled, true);
});

test('the provider deadline covers a hanging fetch regardless of transport abort compliance', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => { signal = init?.signal; return new Promise<Response>(() => {}); };
  const pending = fetchProviderJson(endpoint, {}, { timeoutMs: 1_000 });
  t.mock.timers.tick(1_000);
  await assert.rejects(pending, /timed out/); assert.equal(signal?.aborted, true);
});
test('caller cancellation propagates to hung transport and already-cancelled work never sends credentials', async () => {
  let calls = 0; let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => { calls++; signal = init?.signal; return new Promise<Response>(() => {}); };
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(fetchProviderJson(endpoint, { signal: cancelled.signal }, { timeoutMs: 1_000 }), /cancelled/);
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = fetchProviderJson(endpoint, { signal: controller.signal }, { timeoutMs: 1_000 });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(signal?.aborted, true);
});

test('the provider deadline covers a body and cancellation that never finish', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }));
  const pending = fetchProviderJson(endpoint, {}, { timeoutMs: 1_000 });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  t.mock.timers.tick(1_000);
  await assert.rejects(pending, /timed out/); assert.equal(cancelled, true);
});

test('oversized, malformed and invalid UTF-8 provider replies cannot confirm success', async () => {
  for (const body of ['{"id":"' + 'a'.repeat(100) + '"}', '{invalid', new Uint8Array([0xff])]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(fetchProviderJson(endpoint, {}, { timeoutMs: 1_000, maxBytes: 64 }));
  }
});

test('invalid provider deadline and size policies reject without sending credentials', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({}); };
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 30_001 }, { timeoutMs: 1_000, maxBytes: -1 }, { timeoutMs: 1_000, maxBytes: Number.NaN }]) await assert.rejects(fetchProviderJson(endpoint, {}, options), /Invalid provider acknowledgement limit/);
  assert.equal(calls, 0);
});
