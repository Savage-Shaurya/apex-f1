import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './client';
import { claimJobLease, renewJobLease, releaseJobLease, withJobLease, JobLeaseUnavailableError } from './job-lease';

/** Serialized Drizzle statements only: this fixture never connects to a host. */
async function fixture(run: (state: {
  now: number; writes: number; rows: Map<string, { key: string; token: string; expires: number }>;
  statements: { query: string; parameters: unknown[] }[];
}) => Promise<void>) {
  const previousUrl = process.env.DATABASE_URL;
  const previousWorkerUrl = process.env.DATABASE_WORKER_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  delete process.env.DATABASE_WORKER_URL;
  delete process.env.DATABASE_SSL_CA_PATH;
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const originalBegin = client.begin;
  const state = { now: 100_000, writes: 0, rows: new Map<string, { key: string; token: string; expires: number }>(), statements: [] as { query: string; parameters: unknown[] }[] };
  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    state.statements.push({ query, parameters });
    let result: Record<string, unknown>[] = [];
    if (/^set local (?:lock_timeout|statement_timeout)/.test(query)) {
      assert.match(query, /(?:'5s'|'10s')/);
    } else if (/^\s*insert into job_lease/.test(query)) {
      assert.match(query, /where job_lease\.expires_at <= clock_timestamp\(\)/);
      assert.match(query, /expires_at = clock_timestamp\(\) \+ \$\d+ \* interval '1 second'/);
      const [key, token, ttl, updateTtl] = parameters as [string, string, number, number];
      assert.equal(ttl, updateTtl);
      const old = state.rows.get(key);
      if (!old || old.expires <= state.now) {
        const row = { key, token, expires: state.now + ttl * 1000 };
        state.rows.set(key, row);
        result = [{ key, token, expiresAt: new Date(row.expires).toISOString() }];
      }
    } else if (/^\s*update job_lease/.test(query)) {
      assert.match(query, /token = \$\d+::uuid and expires_at > clock_timestamp\(\)/);
      const [ttl, key, token] = parameters as [number, string, string];
      const old = state.rows.get(key);
      if (old?.token === token && old.expires > state.now) {
        old.expires = state.now + ttl * 1000;
        result = [{ key, token, expiresAt: new Date(old.expires).toISOString() }];
      }
    } else if (/^\s*delete from job_lease/.test(query)) {
      const [key, token] = parameters as [string, string];
      if (state.rows.get(key)?.token === token) { state.rows.delete(key); result = [{ key }]; }
    } else if (/^\s*select key from job_lease/.test(query)) {
      assert.match(query, /expires_at > clock_timestamp\(\)[\s\S]*for update/);
      const [key, token] = parameters as [string, string];
      const row = state.rows.get(key);
      if (row?.token === token && row.expires > state.now) result = [{ key }];
    } else if (query === "select 'protected lease write'") {
      state.writes++;
    } else { throw new Error('Fixture refuses statements outside job lease operations.'); }
    const response = Promise.resolve(result);
    return Object.assign(response, { values: () => response.then((rows) => rows.map((row) => Object.values(row))) });
  });
  Reflect.set(client, 'begin', async (callback: (connection: typeof client) => Promise<unknown>) => {
    const before = structuredClone(state.rows);
    const writes = state.writes;
    try { return await callback(client); }
    catch (error) { state.rows = before; state.writes = writes; throw error; }
  });
  try { await run(state); }
  finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    Reflect.set(client, 'begin', originalBegin);
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousWorkerUrl === undefined) delete process.env.DATABASE_WORKER_URL; else process.env.DATABASE_WORKER_URL = previousWorkerUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
}

test('job lease refuses unconfigured storage without connecting', async () => {
  const previous = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    await assert.rejects(claimJobLease({ key: 'cron:test' }), /not configured/);
    await assert.rejects(renewJobLease({ key: 'cron:test', token: '10000000-0000-4000-8000-000000000001' }), /not configured/);
    await assert.rejects(releaseJobLease({ key: 'cron:test', token: '10000000-0000-4000-8000-000000000001' }), /not configured/);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('lease keys, UUIDs and bounded integer durations are rejected before any SQL', async () => fixture(async (state) => {
  for (const key of ['', ' unsafe', "x';delete", 'x'.repeat(161)]) await assert.rejects(claimJobLease({ key }), /Invalid/);
  for (const ttlSeconds of [0, -1, 1.5, 3601, NaN]) await assert.rejects(claimJobLease({ key: 'valid', ttlSeconds }), /duration/);
  await assert.rejects(releaseJobLease({ key: 'valid', token: 'bad' }), /token/);
  assert.equal(state.statements.length, 0);
}));

test('simultaneous claim attempts produce one active owner and bind every identity', async () => fixture(async (state) => {
  const claims = await Promise.all(Array.from({ length: 4 }, () => claimJobLease({ key: 'cron:video-nightly', ttlSeconds: 90 })));
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims.find((lease) => lease !== null)!;
  assert.equal(winner.expiresAt, new Date(state.now + 90_000).toISOString());
  const statements = state.statements.filter(({ query }) => query.includes('insert into job_lease'));
  assert.equal(new Set(statements.map(({ parameters }) => parameters[1])).size, 4);
  assert.equal(statements.some(({ query }) => query.includes('cron:video-nightly') || query.includes(winner.token)), false);
}));

test('expiry takeover fences stale renewal and release using the database clock', async () => fixture(async (state) => {
  const first = (await claimJobLease({ key: 'cron:test', ttlSeconds: 10 }))!;
  state.now += 10_000;
  assert.equal(await renewJobLease(first), null, 'An expired token cannot revive its lease.');
  const second = (await claimJobLease({ key: 'cron:test', ttlSeconds: 30 }))!;
  assert.notEqual(second.token, first.token);
  assert.equal(await releaseJobLease(first), false);
  assert.equal(await renewJobLease(first, 300), null);
  state.now += 1000;
  const renewed = (await renewJobLease(second, 300))!;
  assert.equal(renewed.expiresAt, new Date(state.now + 300_000).toISOString());
  assert.equal(state.rows.get('cron:test')?.token, second.token);
  assert.equal(await releaseJobLease(second), true);
  assert.equal(await releaseJobLease(second), false);
}));

test('fenced writes roll back if the lease expires before commit', async () => fixture(async (state) => {
  const lease = (await claimJobLease({ key: 'cron:test', ttlSeconds: 10 }))!;
  await assert.rejects(withJobLease(lease, async (tx) => {
    await tx.execute(sql`select 'protected lease write'`);
    state.now += 10_000;
  }), JobLeaseUnavailableError);
  assert.equal(state.writes, 0);
  let invoked = false;
  await assert.rejects(withJobLease(lease, async () => { invoked = true; }), JobLeaseUnavailableError);
  assert.equal(invoked, false);
  const replacement = (await claimJobLease({ key: 'cron:test' }))!;
  assert.equal(await withJobLease(replacement, async (tx) => { await tx.execute(sql`select 'protected lease write'`); return 'committed'; }), 'committed');
  assert.equal(state.writes, 1);
}));

test('separate durable job keys retain independent leases', async () => fixture(async () => {
  const a = (await claimJobLease({ key: 'cron:news' }))!;
  const b = (await claimJobLease({ key: 'cron:weather' }))!;
  assert.notEqual(a.token, b.token);
  assert.equal(await releaseJobLease({ key: b.key, token: a.token }), false);
  assert.equal(await renewJobLease(a) !== null, true);
  assert.equal(await renewJobLease(b) !== null, true);
}));
