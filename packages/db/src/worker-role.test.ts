import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getWorkerDb } from './client';

test('every production host refuses an absent privileged connection before constructing a fallback pool', async () => {
  const names = ['DATABASE_URL', 'DATABASE_WORKER_URL', 'NODE_ENV', 'VERCEL', 'VERCEL_ENV'] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    await closeDb();
    delete process.env.DATABASE_WORKER_URL;
    process.env.DATABASE_URL = 'postgresql://never-contacted@audit.invalid/offline';
    for (const deployment of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { VERCEL_ENV: 'preview' }]) {
      for (const name of ['NODE_ENV', 'VERCEL', 'VERCEL_ENV']) delete process.env[name];
      Object.assign(process.env, deployment);
      assert.throws(() => getWorkerDb(), /DATABASE_WORKER_URL is required/);
    }
  } finally {
    await closeDb();
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
});
