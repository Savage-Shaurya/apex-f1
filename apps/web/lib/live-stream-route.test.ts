import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { openf1 } from '@apex/api-client/openf1';
import { GET } from '../app/api/live/stream/route';
import type { createConfiguredLiveSessionHub } from './live-distributed-hub';
import { liveSourceQuery, type LiveSourceSnapshot } from './live-source-snapshot';

const originalSession = openf1.getLatestSession;
const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env['NODE_ENV'];
const originalUpstashUrl = process.env['UPSTASH_REDIS_REST_URL'];
const originalUpstashToken = process.env['UPSTASH_REDIS_REST_TOKEN'];
const testEnvironment = process.env as Record<string, string | undefined>;
const originalRateLimitEnvironment = Object.fromEntries(['VERCEL', 'VERCEL_ENV', 'DISTRIBUTED_RATE_LIMIT_REQUIRED'].map((key) => [key, testEnvironment[key]]));
const liveProcess = globalThis as typeof globalThis & {
  __apexLiveSessionHubV3?: NonNullable<ReturnType<typeof createConfiguredLiveSessionHub>>;
  __apexOpenLiveStreamsV2?: number;
};
beforeEach(() => {
  testEnvironment['NODE_ENV'] = 'development';
  delete testEnvironment['VERCEL'];
  delete testEnvironment['VERCEL_ENV'];
  testEnvironment['DISTRIBUTED_RATE_LIMIT_REQUIRED'] = 'false';
  delete process.env['UPSTASH_REDIS_REST_URL'];
  delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  openf1.getLatestSession = async () => null;
  globalThis.fetch = async () => { throw new Error('External calls are forbidden in this offline route test'); };
  liveProcess.__apexOpenLiveStreamsV2 = 0;
  liveProcess.__apexLiveSessionHubV3?.dispose();
  delete liveProcess.__apexLiveSessionHubV3;
});
afterEach(() => {
  liveProcess.__apexLiveSessionHubV3?.dispose();
  liveProcess.__apexOpenLiveStreamsV2 = 0;
  openf1.getLatestSession = originalSession;
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete testEnvironment['NODE_ENV'];
  else testEnvironment['NODE_ENV'] = originalNodeEnv;
  if (originalUpstashUrl === undefined) delete process.env['UPSTASH_REDIS_REST_URL'];
  else process.env['UPSTASH_REDIS_REST_URL'] = originalUpstashUrl;
  if (originalUpstashToken === undefined) delete process.env['UPSTASH_REDIS_REST_TOKEN'];
  else process.env['UPSTASH_REDIS_REST_TOKEN'] = originalUpstashToken;
  for (const [key, value] of Object.entries(originalRateLimitEnvironment)) {
    if (value === undefined) delete testEnvironment[key];
    else testEnvironment[key] = value;
  }
});

function request(signal?: AbortSignal) {
  return new Request('http://localhost/api/live/stream', { signal });
}

test('request abort and later reader cancel release the connection exactly once', async () => {
  const abort = new AbortController();
  const response = await GET(request(abort.signal));
  assert.equal(response.status, 200);
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 1);
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: connected/);
  abort.abort();
  assert.equal((await reader.read()).done, true);
  await reader.cancel();
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().running, false);
});

test('canceling an unread slow stream releases its pending channel queue and subscriber', async () => {
  const response = await GET(request());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 1);
  await response.body!.cancel();
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
});

test('capacity rejection does not create a subscriber or consume another slot', async () => {
  liveProcess.__apexOpenLiveStreamsV2 = 64;
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 64);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
});

test('repeated navigation cancellation returns process capacity and ingestion ownership to baseline', async () => {
  for (let index = 0; index < 6; index += 1) {
    const response = await GET(request());
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
    assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
  }
});

test('an already-aborted request opens no connection and performs no ingestion', async () => {
  const controller = new AbortController();
  controller.abort();
  const before = liveProcess.__apexLiveSessionHubV3?.metrics().upstreamRequests ?? 0;
  const response = await GET(request(controller.signal));
  assert.equal((await response.body!.getReader().read()).done, true);
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().upstreamRequests ?? 0, before);
});

test('an enqueue failure releases process capacity through the same idempotent teardown', async () => {
  const originalEnqueue = ReadableStreamDefaultController.prototype.enqueue;
  try {
    ReadableStreamDefaultController.prototype.enqueue = () => { throw new TypeError('Simulated closed downstream'); };
    const response = await GET(request());
    assert.equal((await response.body!.getReader().read()).done, true);
    assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
    assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
  } finally {
    ReadableStreamDefaultController.prototype.enqueue = originalEnqueue;
  }
});

test('production without a shared limiter fails closed before opening a stream', async () => {
  testEnvironment['NODE_ENV'] = 'production';
  const before = liveProcess.__apexLiveSessionHubV3?.metrics().upstreamRequests ?? 0;
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().upstreamRequests ?? 0, before);
});

test('a denied shared opening quota returns429 before subscribing or polling', async () => {
  testEnvironment['NODE_ENV'] = 'production';
  process.env['UPSTASH_REDIS_REST_URL'] = 'https://offline-test.upstash.io';
  process.env['UPSTASH_REDIS_REST_TOKEN'] = 'offline-test-token';
  globalThis.fetch = async (input) => {
    assert.equal(String(input), 'https://offline-test.upstash.io');
    return Response.json({ result: [13, 30_000] });
  };
  const response = await GET(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '30');
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers ?? 0, 0);
});

for (const sourceFailed of [false, true]) test(`configured production streams report shared scope and fenced ${sourceFailed ? 'unavailable lookup' : 'confirmed session absence'}`, async () => {
  testEnvironment['NODE_ENV'] = 'production';
  process.env['UPSTASH_REDIS_REST_URL'] = 'https://offline-test.upstash.io';
  process.env['UPSTASH_REDIS_REST_TOKEN'] = 'offline-test-token';
  let sourceReads = 0;
  openf1.getLatestSession = async (options) => {
    // Raw source checks call the real strict decoder with an in-memory HTTP
    // response. Count only the single actual hub acquisition below.
    if (options?.fetchImpl) return originalSession(options);
    sourceReads += 1;
    if (sourceFailed) throw new Error('Offline fixture source failure');
    return null;
  };
  let revision = 0;
  let liveOwner: string | undefined;
  let queryOwner: string | undefined;
  const rawPublications: LiveSourceSnapshot[] = [];
  const sharedPublications: Array<{ fence: number; frames: Array<{ event: string; data: Record<string, unknown> }> }> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://offline-test.upstash.io');
    const command = JSON.parse(init!.body as string) as string[];
    if (command[0] === 'GET') return Response.json({ result: null });
    assert.equal(command[0], 'EVAL');
    const script = command[1]!;
    if (script.includes('local limit =')) return Response.json({ result: [1, 60_000] });
    if (script.includes('local current =')) {
      if (script.includes("'PX', 25000")) {
        queryOwner = command.at(-1)!;
        return Response.json({ result: [1, 1, 0] });
      }
      liveOwner = command.at(-1)!;
      return Response.json({ result: [1, 1] });
    }
    if (script.includes('ZREMRANGEBYSCORE')) return Response.json({ result: [1, 0] });
    if (script.includes('local incoming = cjson.decode(ARGV[3])')) {
      const keyCount = Number(command[2]);
      const keys = command.slice(3, 3 + keyCount);
      const args = command.slice(3 + keyCount);
      assert.equal(keyCount, 5);
      assert.ok(keys.every((key) => key.includes('{openf1}')));
      assert.equal(keys[3], scopedRedisKey('apex:live:v1:{openf1}:owner'));
      assert.equal(keys[4], scopedRedisKey('apex:live:v1:{openf1}:fence'));
      assert.equal(args[0], queryOwner);
      assert.equal(args[1], '1');
      assert.equal(args[5], liveOwner);
      assert.equal(args[6], '1');
      const raw = JSON.parse(args[2]!) as LiveSourceSnapshot;
      assert.equal(raw.endpoint, 'sessions');
      assert.equal(raw.sessionKey, 'latest');
      assert.equal(raw.query, liveSourceQuery('sessions', 'latest'));
      assert.deepEqual(raw.rows, []);
      rawPublications.push(raw);
      return Response.json({ result: args[2] });
    }
    if (script.includes('local revision')) {
      const keyCount = Number(command[2]);
      const args = command.slice(3 + keyCount);
      assert.equal(args[0], liveOwner);
      assert.equal(args[1], '1');
      const frames = JSON.parse(args[2]!) as Array<{ event: string; data: Record<string, unknown> }>;
      sharedPublications.push({ fence: 1, frames });
      return Response.json({ result: JSON.stringify({ version: 1, fence: 1, revision: ++revision, writtenAt: Date.now(), frames }) });
    }
    assert.ok(script.endsWith('end; return 1'), 'Only explicit fenced release or completion commands may use the numeric reply');
    assert.ok(Number(command[2]) >= 1 && Number(command[2]) <= 2);
    assert.ok(command.slice(3, 3 + Number(command[2])).every((key) => key.includes('{openf1}')));
    return Response.json({ result: 1 });
  };
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 5_000);
  const response = await GET(request(abort.signal));
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  try {
    const connected = new TextDecoder().decode((await reader.read()).value);
    assert.match(connected, /"scope":"shared-snapshot"/);
    const expectedDelivery = sourceFailed ? 'unavailable' : 'snapshot';
    let state: Record<string, unknown> | undefined;
    for (let index = 0; index < 8; index += 1) {
      const frame = await reader.read();
      assert.equal(frame.done, false, 'Confirmed source state must arrive before the bounded stream closes');
      const text = new TextDecoder().decode(frame.value);
      assert.match(text, /event: session_state/);
      const data = JSON.parse(text.match(/data: (.+)/)![1]!) as Record<string, unknown>;
      if (data.delivery === expectedDelivery) { state = data; break; }
      assert.equal(data.delivery, 'unavailable', 'Only an honest unavailable bootstrap may precede the confirmed result');
    }
    assert.ok(state, 'The stream must deliver the source-confirmed result');
    assert.equal(state.delivery, expectedDelivery);
    assert.equal(state.state, 'no_session');
    assert.equal(state.dataTimestamp, null);
    assert.equal(sourceReads, 1);
    assert.equal(rawPublications.length, sourceFailed ? 0 : 1);
    assert.ok(revision >= 1 && revision <= 2, 'Partial source settlement and final refresh may each publish one fenced channel set');
    assert.equal(revision, sharedPublications.length);
    assert.ok(sharedPublications.every((snapshot) => snapshot.fence === 1 && snapshot.frames.some((frame) => frame.event === 'session_state' && frame.data.delivery === expectedDelivery && frame.data.state === 'no_session')));
  } finally { clearTimeout(deadline); abort.abort(); await reader.cancel(); }
  assert.equal(liveProcess.__apexLiveSessionHubV3?.metrics().subscribers, 0);
  assert.equal(liveProcess.__apexOpenLiveStreamsV2, 0);
});
