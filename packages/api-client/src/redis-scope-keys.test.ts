import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJolpicaSharedAdmission, invalidateSharedJolpicaChampionships, JOLPICA_RESERVE_SCRIPT } from './jolpica/shared-admission';
import { createRedisLastGoodStore } from './openf1/last-good';

const config = { url: 'https://fixture.upstash.io', token: 'offline-fixture-token' };
/** What a laptop gets from `.secrets/production.env`: the production Upstash credentials but no deployment marker. */
const localWithProductionEnv = { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: config.url, UPSTASH_REDIS_REST_TOKEN: config.token };

async function admissionKeys(env: Record<string, string | undefined>): Promise<string[]> {
  const seen: string[][] = [];
  const store = createJolpicaSharedAdmission(config, {
    env,
    fetch: async (_url, options) => {
      const command = JSON.parse(String(options?.body)) as string[];
      seen.push(command);
      return Response.json({ result: command[1] === JOLPICA_RESERVE_SCRIPT ? [1, 0, 35000] : 1 });
    },
  });
  await store.reserve('owner-one', new AbortController().signal);
  await store.complete('owner-one', new AbortController().signal);
  await store.backoff!(5_000, new AbortController().signal, 'standings');
  return seen.flatMap((command) => command.slice(3).filter((part) => part.startsWith('apex:')));
}

test('F-07: a local process started with production.env cannot touch the live Jolpica quota, dispatch or backoff keys', async () => {
  const production = await admissionKeys({ VERCEL_ENV: 'production' });
  const local = await admissionKeys(localWithProductionEnv);
  const preview = await admissionKeys({ VERCEL_ENV: 'preview' });
  assert.ok(production.length >= 6);
  assert.ok(production.every((key) => key.startsWith('apex:jolpica:v1:{jolpica}:')), production.join());
  assert.ok(local.every((key) => key.startsWith('apex:local:jolpica:v1:{jolpica}:')), local.join());
  assert.ok(preview.every((key) => key.startsWith('apex:preview:jolpica:v1:{jolpica}:')), preview.join());
  for (const key of local) assert.ok(!production.includes(key), `${key} is shared with production`);
  for (const key of preview) assert.ok(!production.includes(key), `${key} is shared with production`);
});

test('F-07: championship epochs and OpenF1 last-good snapshots are scoped the same way', async () => {
  const epochKeys: string[] = [];
  const record = (into: string[]) => async (_url: unknown, options?: RequestInit) => {
    const command = JSON.parse(String(options?.body)) as string[];
    into.push(...command.filter((part) => part.startsWith('apex:')));
    return Response.json({ result: command[0] === 'EVAL' ? Number(command[2]) : 'OK' });
  };
  await invalidateSharedJolpicaChampionships(2020, config, { fetch: record(epochKeys) as typeof fetch, env: localWithProductionEnv });
  assert.ok(epochKeys.length === 2 && epochKeys.every((key) => key.startsWith('apex:local:jolpica:v1:{jolpica}:championship:epoch:')), epochKeys.join());
  const snapshotKeys: string[] = [];
  const store = createRedisLastGoodStore(config, { fetch: record(snapshotKeys) as typeof fetch, env: localWithProductionEnv });
  await store.write({ version: 1, key: 'a'.repeat(64), storedAt: 1, rows: [] });
  assert.ok(snapshotKeys.length === 1 && snapshotKeys[0]!.startsWith('apex:local:openf1:v1:last-good:'), snapshotKeys.join());
});
