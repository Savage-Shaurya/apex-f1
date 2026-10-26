import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getWorkerDb, type Db } from './client';
import type { DbTransaction } from './source-observation';

export interface JobLeaseIdentity { key: string; token: string }
export interface JobLease extends JobLeaseIdentity { expiresAt: string }
export type JobLeaseTransaction = DbTransaction;

const DEFAULT_TTL_SECONDS = 120;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function validateKey(key: string): void {
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(key)) {
    throw new Error('Invalid job lease key.');
  }
}
function validateIdentity(lease: JobLeaseIdentity): void {
  validateKey(lease.key);
  if (typeof lease.token !== 'string' || !UUID.test(lease.token)) throw new Error('Invalid job lease token.');
}
function leaseTtl(ttlSeconds = DEFAULT_TTL_SECONDS): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) throw new Error('Invalid job lease duration.');
  return ttlSeconds;
}
function configuredDb(): Db {
  if (!process.env.DATABASE_URL) throw new Error('Job lease persistence is not configured.');
  return getWorkerDb();
}
async function boundedLeaseTransaction<T>(callback: (tx: JobLeaseTransaction) => Promise<T>): Promise<T> {
  return configuredDb().transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '10s'`);
    return callback(tx);
  });
}

/** DB clock and a single conditional upsert choose exactly one current owner. */
export async function claimJobLease(input: { key: string; ttlSeconds?: number }): Promise<JobLease | null> {
  validateKey(input.key);
  const key = input.key;
  const ttlSeconds = leaseTtl(input.ttlSeconds);
  const token = randomUUID();
  const rows = await boundedLeaseTransaction((tx) => tx.execute(sql`
    insert into job_lease (key, token, expires_at, created_at, updated_at)
    values (${key}, ${token}::uuid, clock_timestamp() + ${ttlSeconds} * interval '1 second', clock_timestamp(), clock_timestamp())
    on conflict (key) do update set
      token = excluded.token,
      expires_at = clock_timestamp() + ${ttlSeconds} * interval '1 second',
      updated_at = clock_timestamp()
    where job_lease.expires_at <= clock_timestamp()
    returning key, token, expires_at::text as "expiresAt"
  `));
  return (rows[0] as unknown as JobLease | undefined) ?? null;
}

/** An expired owner cannot revive itself or extend a replacement owner's lease. */
export async function renewJobLease(lease: JobLeaseIdentity, ttlSeconds?: number): Promise<JobLease | null> {
  validateIdentity(lease);
  const { key, token } = lease;
  const duration = leaseTtl(ttlSeconds);
  const rows = await boundedLeaseTransaction((tx) => tx.execute(sql`
    update job_lease set expires_at = clock_timestamp() + ${duration} * interval '1 second', updated_at = clock_timestamp()
    where key = ${key} and token = ${token}::uuid and expires_at > clock_timestamp()
    returning key, token, expires_at::text as "expiresAt"
  `));
  return (rows[0] as unknown as JobLease | undefined) ?? null;
}

/** Releasing an old token never releases a newly claimed owner. */
export async function releaseJobLease(lease: JobLeaseIdentity): Promise<boolean> {
  validateIdentity(lease);
  const { key, token } = lease;
  const rows = await boundedLeaseTransaction((tx) => tx.execute(sql`
    delete from job_lease where key = ${key} and token = ${token}::uuid returning key
  `));
  return rows.length === 1;
}

export class JobLeaseUnavailableError extends Error {
  constructor() { super('Job lease is no longer current.'); this.name = 'JobLeaseUnavailableError'; }
}

/** Compose this fence with another durable write in its existing transaction. */
export async function fenceJobLease(tx: JobLeaseTransaction, lease: JobLeaseIdentity): Promise<void> {
  validateIdentity(lease);
  const rows = await tx.execute(sql`
    select key from job_lease
    where key = ${lease.key} and token = ${lease.token}::uuid and expires_at > clock_timestamp()
    for update
  `);
  if (rows.length !== 1) throw new JobLeaseUnavailableError();
}

/**
 * Protect durable writes with the same transaction as the lease check. The row
 * lock excludes another claimant while writes run; expiry at the final fence
 * rolls them back. External calls happen before this bounded write transaction.
 */
export async function withJobLease<T>(lease: JobLeaseIdentity, callback: (tx: JobLeaseTransaction) => Promise<T>): Promise<T> {
  validateIdentity(lease);
  const identity = { ...lease };
  return boundedLeaseTransaction(async (tx) => {
    await fenceJobLease(tx, identity);
    const result = await callback(tx);
    await fenceJobLease(tx, identity);
    return result;
  });
}
