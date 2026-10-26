import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpstashOpenF1ReadStore, parseOpenF1CachedRows } from './openf1-read-store';
import { OPENF1_QUOTA_KEYS } from './live-shared-store';
import { createLiveSourceSnapshot, liveSourceQuery, type LiveSourceSnapshot } from './live-source-snapshot';

const query = 'a'.repeat(64), config = { url: 'https://offline-test.upstash.io', token: 'offline-test-token' };
const signal = () => new AbortController().signal;
test('raw cache metadata is bounded and preserves exact empty arrays and query identities', () => {
  const value = { version: 1, query, writtenAt: Date.now(), rows: [] };
  assert.deepEqual(parseOpenF1CachedRows(JSON.stringify(value), query), value);
  for (const broken of [{ ...value, query: 'b'.repeat(64) }, { ...value, writtenAt: -1 }, { ...value, rows: {} }, { ...value, version: 2 }]) assert.equal(parseOpenF1CachedRows(JSON.stringify(broken), query), null);
  assert.equal(parseOpenF1CachedRows('x'.repeat(1000201), query), null);
});
test('SSR REST admission shares live quota/dispatch keys and cache writes/releases are independently fenced', async () => {
  const commands: string[][] = [];
  const store = createUpstashOpenF1ReadStore(config, { fetch: async (_input, init) => {
    assert.equal(init!.cache, 'no-store'); assert.equal(init!.redirect, 'error');
    const command = JSON.parse(init!.body as string) as string[]; commands.push(command);
    if (command[0] === 'GET') return Response.json({ result: null });
    const script = command[1]!;
    if (script.includes('local current')) return Response.json({ result: [1, 7, 0] });
    if (script.includes('local active')) return Response.json({ result: [0, 0] });
    if (script.includes('local data')) return Response.json({ result: JSON.stringify({ version: 1, query, writtenAt: Date.now(), rows: JSON.parse(command.at(-2)!) }) });
    return Response.json({ result: 1 });
  } });
  assert.equal(await store.read(query, signal()), null);
  assert.deepEqual(await store.claim(query, 'owner', signal()), { owner: true, fence: 7, retryMs: 0 });
  assert.deepEqual(await store.admit('owner', signal()), { retryMs: 0, busy: false });
  assert.deepEqual((await store.publish(query, 'owner', 7, [], 30000, signal()))!.rows, []);
  await store.complete('owner', signal()); await store.release(query, 'owner', 7, signal());
  const admission = commands.find((command) => command[1]?.includes('local active'))!;
  assert.deepEqual(admission.slice(3, 6), [OPENF1_QUOTA_KEYS.quota, OPENF1_QUOTA_KEYS.last, OPENF1_QUOTA_KEYS.dispatch]);
  const publish = commands.find((command) => command[1]?.includes('local data'))!;
  assert.match(publish[1]!, /PTTL/); assert.match(publish[1]!, /ARGV\[2\]/);
  assert.equal(commands.every((command) => JSON.stringify(command).includes(config.token)), false);
});
test('invalid shared rows, identities, TTL and backend responses fail without cache or transport expansion', async () => {
  let calls = 0;
  const store = createUpstashOpenF1ReadStore(config, { fetch: async () => { calls++; return Response.json({ result: 'untrusted-backend-credential' }); } });
  await assert.rejects(store.read(query, signal()), /OpenF1 shared read unavailable/);
  await assert.rejects(store.read('arbitrary-key', signal()), TypeError);
  await assert.rejects(store.publish(query, 'owner', 1, [], 600001, signal()), TypeError);
  await assert.rejects(store.publish(query, 'owner', 1, ["x".repeat(1000001)], 30000, signal()), TypeError);
  assert.equal(calls, 1);
});

const sourceSnapshot = async (at = Date.now()): Promise<LiveSourceSnapshot> => createLiveSourceSnapshot({ endpoint: 'position', sessionKey: 42 }, [{ session_key: 42, driver_number: 1, position: 1, date: new Date(at - 1000).toISOString() }], {
  acquisitionStartedAt: at - 100, acquisitionCompletedAt: at, coverageLower: null, coverageUpper: null,
}, at);
test('raw source publication keeps identical query locks, cluster hash tags and original acquisition expiry', async () => {
  const commands: string[][] = [];
  const snapshot = await sourceSnapshot(), sourceQuery = liveSourceQuery('position', 42);
  const store = createUpstashOpenF1ReadStore(config, { fetch: async (_input, init) => {
    const command = JSON.parse(init!.body as string) as string[]; commands.push(command);
    if (command[0] === 'GET') return Response.json({ result: JSON.stringify(snapshot) });
    if (command[1]!.includes('local incoming')) return Response.json({ result: command[Number(command[2]) + 5] });
    return Response.json({ result: [1, 7, 0] });
  } });
  assert.deepEqual(await store.readSource!(sourceQuery, signal()), snapshot);
  await store.claim(sourceQuery, 'query-owner', signal());
  assert.deepEqual(await store.publishSource!(sourceQuery, 'query-owner', 7, snapshot, 30000, signal()), snapshot);
  assert.deepEqual(await store.publishLiveSource!(sourceQuery, 'query-owner', 7, 'live-owner', 4, snapshot, 30000, signal()), snapshot);
  const writes = commands.filter(command => command[1]?.includes('local incoming'));
  assert.equal(writes.length, 2);
  const queryKeys = commands.find(command => command[1]?.includes('local current'))!.slice(3, 5);
  for (const command of writes) {
    const keyCount = Number(command[2]), keys = command.slice(3, 3 + keyCount), args = command.slice(3 + keyCount);
    assert.deepEqual(keys.slice(0, 2), queryKeys);
    assert.ok(keys.every(key => key.match(/\{([^}]+)\}/)?.[1] === 'openf1'), 'Every EVAL key must be in the same Redis cluster slot');
    assert.equal(args[2], JSON.stringify(snapshot));
    assert.equal(Number(args[4]), snapshot.acquisitionStartedAt + 30000);
    assert.match(command[1]!, /math\.min\(tonumber\(ARGV\[4\]\), expiry - now\)/);
    assert.match(command[1]!, /current\.acquisitionStartedAt > incoming\.acquisitionStartedAt/);
    assert.match(command[1]!, /current\.acquisitionCompletedAt >= incoming\.acquisitionCompletedAt/);
    assert.match(command[1]!, /PTTL', KEYS\[1\]/);
  }
  const live = writes.find(command => command[2] === '5')!;
  assert.deepEqual(live.slice(6, 8), [scopedRedisKey('apex:live:v1:{openf1}:owner'), scopedRedisKey('apex:live:v1:{openf1}:fence')]);
  assert.match(live[1]!, /GET', KEYS\[4\]\) ~= ARGV\[6\]/);
  assert.match(live[1]!, /GET', KEYS\[5\]/); assert.match(live[1]!, /PTTL', KEYS\[4\]/);
  assert.equal(commands.some(command => command[1]?.includes('ZADD')), false, 'Publishing acquired data must not reserve or refund provider starts');
});
test('a rejected fenced or older-source publication remains null without retrying or relabelling the cached data', async () => {
  const snapshot = await sourceSnapshot(); let calls = 0;
  const store = createUpstashOpenF1ReadStore(config, { fetch: async () => { calls++; return Response.json({ result: null }); } });
  assert.equal(await store.publishSource!(snapshot.query, 'query-owner', 1, snapshot, 30000, signal()), null);
  assert.equal(await store.publishLiveSource!(snapshot.query, 'query-owner', 1, 'live-owner', 2, snapshot, 30000, signal()), null);
  assert.equal(calls, 2);
});
test('raw reads revalidate entire strict source rows and original expiry instead of trusting Redis write time', async () => {
  const snapshot = await sourceSnapshot(); let response: unknown = JSON.stringify(snapshot), calls = 0;
  const store = createUpstashOpenF1ReadStore(config, { fetch: async () => { calls++; return Response.json({ result: response }); } });
  for (const value of [
    { ...snapshot, acquisitionStartedAt: Date.now() - 30_000, acquisitionCompletedAt: Date.now() },
    { ...snapshot, rows: [{ ...snapshot.rows[0] as object, session_key: 43 }] },
    { ...snapshot, rows: [{ ...snapshot.rows[0] as object, position: null }, snapshot.rows[0]] },
    { ...snapshot, endpoint: 'intervals' }, { ...snapshot, positionCarry: [{ row: snapshot.rows[0] }] },
    { ...snapshot, token: 'untrusted-test-only' },
  ]) { response = JSON.stringify(value); await assert.rejects(store.readSource!(snapshot.query, signal())); }
  response = '{malformed'; await assert.rejects(store.readSource!(snapshot.query, signal()));
  response = null; assert.equal(await store.readSource!(snapshot.query, signal()), null);
  assert.equal(calls, 8);
});
test('invalid raw source identity, credentials, hard TTL, response size and cancellation fail before Redis publication', async () => {
  const snapshot = await sourceSnapshot(); let calls = 0;
  const store = createUpstashOpenF1ReadStore(config, { fetch: async () => { calls++; return Response.json({ result: null }); } });
  await assert.rejects(store.publishSource!(query, 'query-owner', 1, snapshot, 30000, signal()), TypeError);
  await assert.rejects(store.publishSource!(snapshot.query, 'query-owner', 0, snapshot, 30000, signal()), TypeError);
  await assert.rejects(store.publishSource!(snapshot.query, 'query-owner', 1, snapshot, 30001, signal()), TypeError);
  await assert.rejects(store.publishSource!(snapshot.query, 'query-owner', 1, snapshot, 0, signal()), TypeError);
  await assert.rejects(store.publishLiveSource!(snapshot.query, 'query-owner', 1, 'bad live owner', 2, snapshot, 30000, signal()), TypeError);
  await assert.rejects(store.publishSource!(snapshot.query, 'query-owner', 1, { ...snapshot, rows: ['x'.repeat(1_000_001)] }, 30000, signal()));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.publishSource!(snapshot.query, 'query-owner', 1, snapshot, 30000, controller.signal));
  assert.equal(calls, 0);
});
