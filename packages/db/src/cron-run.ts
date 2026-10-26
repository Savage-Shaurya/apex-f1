import { eq } from 'drizzle-orm';
import { getWorkerDb } from './client';
import { ingestionRun } from './schema';
import { withJobLease, type JobLeaseIdentity } from './job-lease';

/** Opens a durable run record inside the job's lease fence; a stale owner cannot write one. */
export async function openIngestionRun(lease: JobLeaseIdentity, source: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(source)) throw new Error('Invalid ingestion run source.');
  const [row] = await withJobLease(lease, (tx) => tx.insert(ingestionRun).values({ source, status: 'running' }).returning({ id: ingestionRun.id }));
  if (!row) throw new Error('Ingestion run was not opened.');
  return row.id;
}

/** Closes a run with its real outcome. Errors are truncated and never include provider bodies. */
export async function closeIngestionRun(runId: string, outcome: { ok: boolean; error?: string }): Promise<void> {
  await getWorkerDb().update(ingestionRun)
    .set({ status: outcome.ok ? 'success' : 'failed', endedAt: new Date(), error: outcome.error ? outcome.error.slice(0, 2_000) : null })
    .where(eq(ingestionRun.id, runId));
}
