import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from './client';
import { boundedTransaction, transactionLimitsSql } from './bounded-transaction';

test('limits are validated before any statement is built', () => {
  assert.throws(() => transactionLimitsSql({ statementMs: 0, lockMs: 5_000, idleMs: 15_000 }), /Invalid transaction limit/);
  assert.throws(() => transactionLimitsSql({ statementMs: 15_000, lockMs: Number.NaN, idleMs: 15_000 }), /Invalid transaction limit/);
});

test('every bounded transaction first sets statement, lock and idle timeouts locally in one round trip', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const originalBegin = client.begin;
  const statements: { query: string; parameters: unknown[] }[] = [];
  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    statements.push({ query, parameters });
    const rows = Promise.resolve([{ ok: 1 }]);
    return Object.assign(rows, { values: () => rows.then((values) => values.map((row) => Object.values(row))) });
  });
  Reflect.set(client, 'begin', async (callback: (connection: typeof client) => Promise<unknown>) => callback(client));
  try {
    const { sql } = await import('drizzle-orm');
    await boundedTransaction(getDb(), (tx) => tx.execute(sql`select 1`));
    assert.equal(statements.length, 2);
    assert.match(statements[0]!.query, /^select set_config\('statement_timeout', \$1, true\),\s+set_config\('lock_timeout', \$2, true\),\s+set_config\('idle_in_transaction_session_timeout', \$3, true\)/);
    assert.deepEqual(statements[0]!.parameters, ['15000ms', '5000ms', '15000ms']);
    assert.equal(statements[1]!.query, 'select 1');
  } finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    Reflect.set(client, 'begin', originalBegin);
    await closeDb();
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});
