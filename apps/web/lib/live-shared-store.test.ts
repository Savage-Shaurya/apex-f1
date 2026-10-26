import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { liveStoreConfig, mayUseProcessLiveHub, createUpstashLiveSharedStore, parseLiveSharedSnapshot } from './live-shared-store';
import { sanitizeLiveFrame, sanitizeLiveFrames } from './live-frame-schema';

const config = { url: 'https://offline-test.upstash.io', token: 'offline-test-token' };
const signal = () => new AbortController().signal;
const snapshot = JSON.stringify({ version: 1, fence: 1, revision: 1, writtenAt: Date.now(), frames: [{ event: 'session_state', data: { state: 'no_session', delivery: 'unavailable' } }] });

test('strict shared-store config rejects credential forwarding origins and malformed token values', () => {
  assert.deepEqual(liveStoreConfig({ UPSTASH_REDIS_REST_URL: `${config.url}/`, UPSTASH_REDIS_REST_TOKEN: config.token }), config);
  for (const url of ['http://offline-test.upstash.io', 'https://upstash.io', 'https://x.upstash.io.evil.test', 'https://x.upstash.io:444', 'https://user:pass@x.upstash.io', 'https://x.upstash.io/path', 'https://x.upstash.io/?x=1', 'https://x.upstash.io/#fragment']) {
    assert.equal(liveStoreConfig({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: config.token }), null, url);
  }
  for (const token of ['', 'a b', 'a\nheader', 'x'.repeat(4_097)]) assert.equal(liveStoreConfig({ UPSTASH_REDIS_REST_URL: config.url, UPSTASH_REDIS_REST_TOKEN: token }), null);
  assert.equal(mayUseProcessLiveHub({ NODE_ENV: 'production' }), false);
  assert.equal(mayUseProcessLiveHub({ NODE_ENV: 'development', VERCEL: '1' }), false);
  assert.equal(mayUseProcessLiveHub({ NODE_ENV: 'development', VERCEL_ENV: 'preview' }), false);
  assert.equal(mayUseProcessLiveHub({ NODE_ENV: 'development' }), true);
});

test('shared frames whitelist fields, limit rows/text, preserve timestamps and reject unknown channels', () => {
  const clean = sanitizeLiveFrame({ event: 'tower', data: { rows: Array.from({ length: 500 }, () => ({ driver: 4, pos: 1, full_name: 'N'.repeat(1000), token: 'secret' })), dataTimestamp: 1234, sourceUpdatedAt: 1234, token: 'secret' } })!;
  assert.equal((clean.data.rows as unknown[]).length, 30);
  assert.equal(clean.data.dataTimestamp, 1234);
  assert.equal(clean.data.sourceUpdatedAt, 1234);
  assert.equal(JSON.stringify(clean).includes('secret'), false);
  assert.equal((clean.data.rows as Array<{ full_name: string }>)[0]!.full_name.length, 120);
  assert.equal(sanitizeLiveFrame({ event: 'malicious', data: {} }), null);
  assert.equal(sanitizeLiveFrames(Array(5).fill(clean)), null);
  assert.equal(sanitizeLiveFrames([clean, clean]), null);
  assert.equal(sanitizeLiveFrames([{ event: 'session_state', data: { state: 'live', session_key: 42 } }, { event: 'tower', data: { sessionKey: 99, rows: [] } }]), null);
  assert.equal(sanitizeLiveFrames([{ event: 'session_state', data: { state: 'no_session' } }, { event: 'tower', data: { sessionKey: 42, rows: [] } }]), null);
  assert.equal(sanitizeLiveFrame({ event: 'session_state', data: { state: 'live', session_key: 42 } })!.data.delivery, 'unavailable');
  assert.equal(parseLiveSharedSnapshot('x'), null);
  assert.equal(parseLiveSharedSnapshot(snapshot)?.frames[0]?.data.delivery, 'unavailable');
});

test('REST operations are no-store, non-redirecting, signal-bound and use fenced atomic scripts', async () => {
  const commands: string[][] = [];
  const store = createUpstashLiveSharedStore(config, { fetch: async (input, init) => {
    assert.equal(input, config.url);
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    const command = JSON.parse(init!.body as string) as string[];
    commands.push(command);
    if (command[0] === 'GET') return Response.json({ result: snapshot });
    if (command[1]!.includes("local current")) return Response.json({ result: [1, 1] });
    if (command[1]!.includes("ZREMRANGEBYSCORE")) return Response.json({ result: [1, 2_300] });
    if (command[1]!.includes('local revision')) return Response.json({ result: snapshot });
    return Response.json({ result: 1 });
  } });
  assert.deepEqual(await store.claim('owner', signal()), { owner: true, fence: 1 });
  assert.deepEqual(await store.reserve('owner', 1, signal()), { owned: true, retryMs: 2_300 });
  assert.ok(await store.publish('owner', 1, [{ event: 'session_state', data: { state: 'no_session' } }], signal()));
  assert.ok(await store.read(signal()));
  await store.release('owner', 1, signal());
  assert.equal(commands.length, 5);
  assert.match(commands[1]![1]!, /redis.call\('TIME'\)/);
  assert.match(commands[1]![1]!, /count >= 26/);
  assert.match(commands[2]![1]!, /PTTL/);
  assert.match(commands[2]![1]!, /Preserve JSON empty arrays/);
});

test('timeouts include ignored fetch cancellation and stalled body; no abort listeners accumulate', async () => {
  for (const fetcher of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    const store = createUpstashLiveSharedStore(config, { fetch: fetcher, timeoutMs: 10 });
    const controller = new AbortController();
    const started = Date.now();
    await assert.rejects(store.claim('owner', controller.signal), /Live shared store unavailable/);
    assert.ok(Date.now() - started < 500);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});

test('oversized, malformed, HTTP failures and backend error bodies fail without secret details', async () => {
  for (const response of [Response.json({ error: 'secret upstream body' }), new Response('x'.repeat(200_000)), new Response('bad json'), new Response('secret', { status: 500 }), Response.json({ result: [1, -1] })]) {
    const store = createUpstashLiveSharedStore(config, { fetch: async () => response });
    await assert.rejects(store.claim('owner', signal()), (error: Error) => error.message === 'Live shared store unavailable');
  }
});

test('opaque causal checkpoints remain private and follow command order during overlap', async () => {
  const seen: Array<string | undefined> = [];
  let completeFirst: (() => void) | null = null;
  let calls = 0;
  const store = createUpstashLiveSharedStore(config, { fetch: async (_input, init) => {
    seen.push((init?.headers as Record<string, string>)['upstash-sync-token']);
    calls += 1;
    if (calls === 1) await new Promise<void>((resolve) => { completeFirst = resolve; });
    return Response.json({ result: [1, 1] }, { headers: { 'upstash-sync-token': `private-checkpoint-${calls}` } });
  } });
  const first = store.claim('owner', signal());
  const second = store.claim('owner', signal());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  (completeFirst as (() => void) | null)?.();
  const results = await Promise.all([first, second]);
  assert.deepEqual(seen, [undefined, 'private-checkpoint-1']);
  assert.equal(JSON.stringify(results).includes('private-checkpoint'), false);
});

test('a queued command is immediately cancellable and its entire queue wait has a deadline', async () => {
  let calls = 0;
  const store = createUpstashLiveSharedStore(config, { timeoutMs: 30, fetch: async () => { calls += 1; return new Promise<Response>(() => {}); } });
  const first = store.claim('owner', signal());
  let firstSettled = false;
  const firstRejection = assert.rejects(first, /Live shared store unavailable/).then(() => { firstSettled = true; });
  const abort = new AbortController();
  const second = store.claim('owner', abort.signal);
  abort.abort();
  await assert.rejects(second, /Live shared store unavailable/);
  assert.equal(firstSettled, false, 'cancellation completes before its stalled predecessor');
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  const thirdStarted = Date.now();
  await assert.rejects(store.claim('owner', signal()), /Live shared store unavailable/);
  assert.ok(Date.now() - thirdStarted < 500);
  await firstRejection;
  assert.ok(calls <= 2);
});

test('canceling a middle queued command does not let its successor overtake the active predecessor', async () => {
  let calls = 0;
  let completeFirst: (() => void) | null = null;
  const seen: Array<string | undefined> = [];
  const store = createUpstashLiveSharedStore(config, { fetch: async (_input, init) => {
    calls += 1;
    seen.push((init?.headers as Record<string, string>)['upstash-sync-token']);
    if (calls === 1) await new Promise<void>((resolve) => { completeFirst = resolve; });
    return Response.json({ result: [1, 1] }, { headers: { 'upstash-sync-token': `checkpoint-${calls}` } });
  } });
  const first = store.claim('owner', signal());
  const abort = new AbortController();
  const middle = store.claim('owner', abort.signal);
  abort.abort();
  await assert.rejects(middle, /Live shared store unavailable/);
  const last = store.claim('owner', signal());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  (completeFirst as (() => void) | null)?.();
  await Promise.all([first, last]);
  assert.deepEqual(seen, [undefined, 'checkpoint-1']);
});

test('oversized causal token headers fail closed without copying the token into errors', async () => {
  const store = createUpstashLiveSharedStore(config, { fetch: async () => Response.json({ result: [1, 1] }, { headers: { 'upstash-sync-token': 'private'.repeat(700) } }) });
  await assert.rejects(store.claim('owner', signal()), (error: Error) => error.message === 'Live shared store unavailable');
});
test('each live dispatch has a private unique completion token even for the same owner and fence', async () => {
  const commands: string[][] = [];
  const store = createUpstashLiveSharedStore({ url: 'https://offline-test.upstash.io', token: 'offline-test-token' }, { fetch: async (_input, init) => {
    const command = JSON.parse(init!.body as string) as string[]; commands.push(command);
    return Response.json({ result: command[1]!.includes('ZREMRANGEBYSCORE') ? [1, 0] : 1 });
  } });
  await store.reserve('owner', 1, new AbortController().signal); await store.complete!('owner', 1, new AbortController().signal);
  await store.reserve('owner', 1, new AbortController().signal); await store.complete!('owner', 1, new AbortController().signal);
  const reservations = commands.filter((command) => command[1]!.includes('ZREMRANGEBYSCORE'));
  const completions = commands.filter((command) => !command[1]!.includes('ZREMRANGEBYSCORE'));
  assert.notEqual(reservations[0]!.at(-1), reservations[1]!.at(-1));
  assert.equal(completions[0]!.at(-1), reservations[0]!.at(-1)); assert.equal(completions[1]!.at(-1), reservations[1]!.at(-1));
});
