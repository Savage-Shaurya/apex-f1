import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getWorkerDb, type Db } from './client';
import { boundedTransaction } from './bounded-transaction';
import { fenceJobLease, type JobLeaseIdentity } from './job-lease';

export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
export interface SourceObservation { source: string; scope: string; generation: string; observationId: string; jobLease?: JobLeaseIdentity }
export class SourceObservationSupersededError extends Error {
  constructor() { super('Source observation was superseded or expired; no snapshot was applied.'); this.name = 'SourceObservationSupersededError'; }
}
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9:_./-]{0,159}$/;
export function validateSourceObservation(input: SourceObservation): void {
  if (!KEY.test(input.source) || !KEY.test(input.scope) || !/^[1-9]\d{0,18}$/.test(input.generation)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.observationId)) throw new Error('Invalid source observation.');
}

/** Must be called BEFORE an uncached complete provider read, never after it. */
export async function beginSourceObservation(input: { source: string; scope: string; ttlSeconds?: number; jobLease?: JobLeaseIdentity }): Promise<SourceObservation> {
  if (!process.env.DATABASE_URL) throw new Error('Source observations are not configured.');
  const ttl = input.ttlSeconds ?? 300;
  if (!KEY.test(input.source) || !KEY.test(input.scope) || !Number.isInteger(ttl) || ttl < 1 || ttl > 3600) throw new Error('Invalid source observation lease.');
  const observationId = randomUUID();
  const rows = await boundedTransaction(getWorkerDb(), async (tx) => {
    if (input.jobLease) await fenceJobLease(tx, input.jobLease);
    return tx.execute(sql`insert into source_snapshot (source, scope, generation, observation_id, issued_at, expires_at)
    values (${input.source}, ${input.scope}, 1, ${observationId}::uuid, clock_timestamp(), clock_timestamp() + ${ttl} * interval '1 second')
    on conflict (source, scope) do update set generation = source_snapshot.generation + 1,
      observation_id = excluded.observation_id, issued_at = excluded.issued_at, expires_at = excluded.expires_at
    returning generation::text`);
  });
  if (!rows[0]?.generation) throw new Error('Source observation could not be reserved.');
  return { source: input.source, scope: input.scope, generation: String(rows[0].generation), observationId, ...(input.jobLease ? { jobLease: input.jobLease } : {}) };
}

/** Serializes snapshot writers and rejects delayed older jobs atomically. */
export async function fenceSourceObservation(tx: DbTransaction, observation: SourceObservation): Promise<void> {
  validateSourceObservation(observation);
  if (observation.jobLease) await fenceJobLease(tx, observation.jobLease);
  const rows = await tx.execute(sql`select generation from source_snapshot where source = ${observation.source} and scope = ${observation.scope}
    and generation = ${observation.generation}::bigint and observation_id = ${observation.observationId}::uuid
    and expires_at > clock_timestamp() for update`);
  if (rows.length !== 1) throw new SourceObservationSupersededError();
}
export async function withSourceObservation<T>(observation: SourceObservation, callback: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return boundedTransaction(getWorkerDb(), async (tx) => { await fenceSourceObservation(tx, observation); const result = await callback(tx); await fenceSourceObservation(tx, observation); return result; });
}

/** Record equality/progress under the SAME locked transaction as stored data. */
export async function completeSourceObservation(tx: DbTransaction, observation: SourceObservation, contentHash: string | null = null, details: Record<string, unknown> = {}): Promise<void> {
  if (contentHash !== null && !/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('Invalid source content hash.');
  await tx.execute(sql`update source_snapshot set applied_at = clock_timestamp(), applied_observation_id = ${observation.observationId}::uuid, content_hash = ${contentHash},
    details = details || ${JSON.stringify(details)}::jsonb where source = ${observation.source} and scope = ${observation.scope}
      and generation = ${observation.generation}::bigint and observation_id = ${observation.observationId}::uuid`);
}
