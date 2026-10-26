import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readThenRefresh, refreshTagKeepingLastGood } from './cache-refresh';

// R3-BE-4: a cron refresh must never throw away the last good copy before it
// has a replacement. Drives the helper the rss-sync and weather-sync routes use.
test('R3-BE-4: a failing read leaves the cache tag untouched (last good copy kept)', async () => {
  const calls: Array<[string, string]> = [];
  const revalidate = (tag: string, profile: string) => { calls.push([tag, profile]); };
  await assert.rejects(readThenRefresh('rss-news', async () => { throw new Error('feed down'); }, revalidate), /feed down/);
  assert.deepEqual(calls, []);
});

test('R3-BE-4: a successful read refreshes the tag stale-while-revalidate, never immediate expiry', async () => {
  const order: string[] = [];
  const revalidate = (tag: string, profile: string) => { order.push(`refresh:${tag}:${profile}`); };
  const value = await readThenRefresh('rss-news', async () => { order.push('read'); return 42; }, revalidate);
  assert.equal(value, 42);
  assert.deepEqual(order, ['read', 'refresh:rss-news:max']);
  const direct: string[] = [];
  refreshTagKeepingLastGood('weather:forecast', (tag, profile) => { direct.push(`${tag}:${profile}`); });
  assert.deepEqual(direct, ['weather:forecast:max']);
});
