import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redisKeyScope, scopedRedisKey } from './redis-scope';

const config = { url: 'https://fixture.upstash.io', token: 'offline-fixture-token' };
/** What a laptop gets from `.secrets/production.env`: the production Upstash credentials but no deployment marker. */
const localWithProductionEnv = { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: config.url, UPSTASH_REDIS_REST_TOKEN: config.token };

test('F-07: only the production deployment uses unscoped (production budget) Redis keys', () => {
  assert.equal(redisKeyScope({ VERCEL_ENV: 'production' }), null);
  assert.equal(redisKeyScope({ APEX_ENV: 'production' }), null, 'a self-hosted production run opts in explicitly');
  assert.equal(redisKeyScope(localWithProductionEnv), 'local', 'production.env on a laptop is not production');
  assert.equal(redisKeyScope({}), 'local');
  assert.equal(redisKeyScope({ VERCEL_ENV: 'preview' }), 'preview');
  assert.equal(redisKeyScope({ VERCEL_ENV: 'development' }), 'development');
  assert.equal(redisKeyScope({ VERCEL_ENV: 'preview', APEX_ENV: 'production' }), 'preview', 'a preview cannot claim the production budget');
  assert.equal(redisKeyScope({ APEX_ENV: 'staging' }), 'staging');
  assert.equal(redisKeyScope({ APEX_REDIS_SCOPE: 'auditfix-data' }), 'local-auditfix-data', 'a per-process scope isolates one agent or worktree');
  assert.equal(redisKeyScope({ VERCEL_ENV: 'production', APEX_REDIS_SCOPE: 'x' }), null, 'production keys never move');
  assert.equal(redisKeyScope({ APEX_ENV: 'Bad Scope!' }), 'local', 'an unusable label falls back to the safe local scope');
  assert.equal(scopedRedisKey('apex:jolpica:v1:{jolpica}', { VERCEL_ENV: 'production' }), 'apex:jolpica:v1:{jolpica}');
  assert.equal(scopedRedisKey('apex:jolpica:v1:{jolpica}', { VERCEL_ENV: 'preview' }), 'apex:preview:jolpica:v1:{jolpica}');
  assert.throws(() => scopedRedisKey('other:key', {}));
});
