import { sql } from 'drizzle-orm';
import type { Db } from './client';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Timeouts for every application transaction (BE-10).
 *
 * client.ts sends statement/lock/idle timeouts as connection startup
 * parameters, but Supabase's transaction pooler (port 6543) does not apply
 * them: measured on apex-staging 2026-10-26, a pooled session ran with
 * statement_timeout = 2min, lock_timeout = 0 and idle_in_transaction = 0, and
 * a 16 s pg_sleep completed. Transaction-local settings do apply through the
 * pooler, so each transaction sets them first, in one round trip. Role-level
 * defaults (security/0006_role_session_timeouts.sql) cover single statements.
 */
export const TRANSACTION_LIMITS = { statementMs: 15_000, lockMs: 5_000, idleMs: 15_000 } as const;

export function transactionLimitsSql(limits: { statementMs: number; lockMs: number; idleMs: number } = TRANSACTION_LIMITS) {
  for (const value of [limits.statementMs, limits.lockMs, limits.idleMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 600_000) throw new Error('Invalid transaction limit.');
  }
  return sql`select set_config('statement_timeout', ${`${limits.statementMs}ms`}, true),
    set_config('lock_timeout', ${`${limits.lockMs}ms`}, true),
    set_config('idle_in_transaction_session_timeout', ${`${limits.idleMs}ms`}, true)`;
}

export async function boundedTransaction<T>(db: Db, callback: (tx: Transaction) => Promise<T>, limits?: { statementMs: number; lockMs: number; idleMs: number }): Promise<T> {
  const bounds = transactionLimitsSql(limits);
  return db.transaction(async (tx) => {
    await tx.execute(bounds);
    return callback(tx);
  });
}
