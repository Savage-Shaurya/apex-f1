/* Lightweight worker runner: opens an ingestion_run row, runs the task,
 * marks success/fail, logs progress. Use across every ingest script.
 */

import { getWorkerDb, schema, claimJobLease, renewJobLease, releaseJobLease, withJobLease } from '@apex/db';
import { eq } from 'drizzle-orm';
import { runLeasedJob, type JobContext } from './job-control';
import { workerBudgetMs } from './worker-policy';

export interface RunContext extends JobContext {
  runId: string;
  log: (msg: string) => void;
  bump: (delta: { itemsIn?: number; itemsOut?: number }) => void;
}

export async function runWorker(
  source: string,
  task: (ctx: RunContext) => Promise<void>,
  options: { budgetMs?: number } = {},
): Promise<void> {
  const result = await runLeasedJob(source, {
    claim: claimJobLease, renew: renewJobLease, release: releaseJobLease,
  }, (job) => recordWorker(source, job, task), { budgetMs: workerBudgetMs(source, options.budgetMs) });
  if (result.status === 'busy') console.info(`[${source}] Another owner is running; no provider requests or writes were started.`);
  else if (result.cleanup === 'release-failed') console.warn(`[${source}] Work completed, but the job lease could not be released; it expires on its own.`);
}

async function recordWorker(source: string, job: JobContext, task: (ctx: RunContext) => Promise<void>): Promise<void> {
  const db = getWorkerDb();
  const [row] = await withJobLease(job.lease, (tx) => tx
    .insert(schema.ingestionRun)
    .values({ source, status: 'running' })
    .returning({ id: schema.ingestionRun.id }));
  if (!row) throw new Error('failed to open ingestion_run');
  const runId = row.id;

  let itemsIn = 0;
  let itemsOut = 0;
  const t0 = Date.now();

  const log = (msg: string) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`[${source} ${runId.slice(0, 8)} +${elapsed}s] ${msg}`);
  };
  const bump = (d: { itemsIn?: number; itemsOut?: number }) => {
    itemsIn += d.itemsIn ?? 0;
    itemsOut += d.itemsOut ?? 0;
  };

  try {
    log('start');
    await task({ ...job, runId, log, bump });
    job.assertActive();
    await withJobLease(job.lease, (tx) => tx
      .update(schema.ingestionRun)
      .set({ status: 'success', endedAt: new Date(), itemsIn, itemsOut })
      .where(eq(schema.ingestionRun.id, runId)));
    log(`done in=${itemsIn} out=${itemsOut}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.update(schema.ingestionRun).set({ status: 'failed', endedAt: new Date(), itemsIn, itemsOut, error: message.slice(0, 2000) })
        .where(eq(schema.ingestionRun.id, runId));
    } catch {
      console.error(`[${source}] Could not record the failed ingestion run.`);
    }
    // eslint-disable-next-line no-console
    console.error(`[${source}] FAILED: ${message}`);
    throw err;
  }
}

/** Polite delay between paginated API calls. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal?.reason); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
