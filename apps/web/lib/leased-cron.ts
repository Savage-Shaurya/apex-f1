import { claimJobLease, renewJobLease, releaseJobLease, openIngestionRun, closeIngestionRun } from '@apex/db';
import { runLeasedJob, JobBudgetError, type JobContext, type Lease, type LeaseStore } from '../../workers/src/lib/job-control';
import { describeError } from '../../workers/src/lib/describe-error';
import { buildReport, isAuthorizedCronRequest, logReport } from './cron-auth';
import { logEvent } from './log';

const store: LeaseStore = { claim: claimJobLease, renew: renewJobLease, release: releaseJobLease };
const BUDGET_MS = 45_000;

/** Durable cron history: one ingestion_run row per owned run, opened inside the lease fence. */
export interface CronRunRecorder {
  open(route: string, lease: Lease): Promise<string>;
  close(runId: string, outcome: { ok: boolean; error?: string }): Promise<void>;
}
export const databaseCronRecorder: CronRunRecorder = {
  open: (route, lease) => openIngestionRun(lease, `cron:${route}`),
  close: closeIngestionRun,
};

export interface LeasedCronOptions {
  /**
   * 'required' (default): a durable database lease owns the run.
   * 'optional': for idempotent cache-only jobs (news, weather, video cache
   * refresh). Without DATABASE_URL they run unleased instead of failing every
   * scheduled invocation; with it they still take the lease, and when the
   * database is configured but unreachable (the lease store throws) they also
   * run unleased, flagged `x-apex-cron-lease: unavailable` (R3-BE-3). A run
   * record that cannot be opened or closed never fails such a job.
   */
  lease?: 'required' | 'optional';
  store?: LeaseStore;
  /** Defaults to the database recorder with the default store; null disables recording. */
  recorder?: CronRunRecorder | null;
  /**
   * The task stops at the time budget on its own and marks its partial report
   * with `x-apex-job-partial: budget` (committed work kept, rest deferred).
   * Such a report is returned instead of a bare 503 that loses the progress.
   */
  partialOnBudget?: boolean;
}

/** Header a task sets on a report that stopped, honestly, at the time budget. */
export const PARTIAL_ON_BUDGET_HEADER = 'x-apex-job-partial';

/** A context for cache-only work with no database: budget and cancellation, but no lease to fence writes. */
function unleasedContext(route: string, signal: AbortSignal): { context: JobContext; dispose(): void } {
  const controller = new AbortController();
  const expiresAt = Date.now() + BUDGET_MS;
  const budget = setTimeout(() => controller.abort(new JobBudgetError()), BUDGET_MS);
  const forward = () => controller.abort(signal.reason);
  signal.addEventListener('abort', forward, { once: true });
  if (signal.aborted) forward();
  // Not a database lease: any fenced write attempted with it fails closed.
  const lease: Lease = { key: `unleased:${route}`, token: '00000000-0000-4000-8000-000000000000', expiresAt: new Date(expiresAt).toISOString() };
  return {
    context: {
      signal: controller.signal, lease, expiresAt, unleased: true,
      remainingMs: () => Math.max(0, expiresAt - Date.now()),
      assertActive() { controller.signal.throwIfAborted(); if (Date.now() >= expiresAt) throw new JobBudgetError(); },
    },
    dispose() { clearTimeout(budget); signal.removeEventListener('abort', forward); controller.abort(); },
  };
}

async function outcomeOf(response: Response): Promise<{ ok: boolean; error?: string }> {
  if (!response.ok) {
    try { const body = await response.clone().json() as { error?: unknown }; return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${response.status}` }; }
    catch { return { ok: false, error: `HTTP ${response.status}` }; }
  }
  return { ok: true };
}

/** Authentication always precedes acquiring a durable job owner. */
export async function runLeasedCron(
  request: Request,
  route: string,
  task: (context: JobContext) => Promise<Response>,
  storeOrOptions: LeaseStore | LeasedCronOptions = {},
): Promise<Response> {
  const start = Date.now();
  if (!isAuthorizedCronRequest(request)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const options: LeasedCronOptions = 'claim' in storeOrOptions ? { store: storeOrOptions, recorder: null } : storeOrOptions;
  const leaseStore = options.store ?? store;
  const recorder = options.recorder === undefined ? (options.store ? null : databaseCronRecorder) : options.recorder;

  const optional = options.lease === 'optional';
  /** Cache-only work without a durable owner: budget and cancellation, no lease. */
  const runUnleased = async (label: string): Promise<Response> => {
    const { context, dispose } = unleasedContext(route, request.signal);
    try {
      const response = await task(context);
      response.headers.set('x-apex-cron-lease', label);
      return response;
    } catch (error) {
      const cause = describeError(error);
      logEvent('error', 'cron.exception', { route, lease: 'none', cause });
      const report = buildReport(start, { ok: false, route, error: `Cache-only job failed or ran out of time; the next scheduled run retries. Cause: ${cause}` });
      logReport(report);
      return Response.json(report, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
    } finally { dispose(); }
  };

  if (optional && !process.env.DATABASE_URL) return runUnleased('none; cache-only run without DATABASE_URL');

  // The lease store failing (database configured but unreachable) is told apart from a task failure.
  let claimError: { error: unknown } | null = null;
  const observedStore: LeaseStore = {
    ...leaseStore,
    claim: async (input) => {
      try { return await leaseStore.claim(input); } catch (error) { claimError = { error }; throw error; }
    },
  };
  try {
    const result = await runLeasedJob(route, observedStore, async (job) => {
      let runId: string | null = null;
      if (recorder) {
        try { runId = await recorder.open(route, job.lease); }
        catch (error) {
          // The run record is history, not the job: cache-only jobs keep going without it.
          if (!optional) throw error;
          console.error(`[cron] ${route} run record could not be opened: ${describeError(error)}`);
        }
      }
      let response: Response;
      try { response = await task(job); }
      catch (error) {
        if (runId) await recorder!.close(runId, { ok: false, error: `Task failed before producing a report: ${describeError(error)}` }).catch(() => undefined);
        throw error;
      }
      if (runId) await recorder!.close(runId, await outcomeOf(response)).catch(() => undefined);
      return response;
    }, {
      budgetMs: BUDGET_MS, ttlSeconds: 120, signal: request.signal,
      ...(options.partialOnBudget ? { acceptPartialOnBudget: (response: Response) => response.headers.get(PARTIAL_ON_BUDGET_HEADER) === 'budget' } : {}),
    });
    if (result.status === 'completed') {
      if (result.cleanup === 'release-failed') {
        // The work finished; only the lease release failed (it expires on its own).
        logReport(buildReport(start, { ok: false, route, error: 'Job lease release failed after the task finished; the lease expires on its own.' }));
        result.value.headers.set('x-apex-cron-lease', 'release-failed; expires automatically');
      }
      return result.value;
    }
    const report = buildReport(start, { ok: true, route, skipped: 'Another owner is running this job; no duplicate work was started.' });
    logReport(report);
    return Response.json(report, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const failedClaim = claimError as { error: unknown } | null;
    if (optional && failedClaim) {
      logEvent('warn', 'cron.lease_unavailable', { route, cause: describeError(failedClaim.error), fallback: 'cache-only run, unleased' });
      return runUnleased('unavailable; cache-only run while the job database is unreachable');
    }
    const cause = describeError(failedClaim ? failedClaim.error : error);
    logEvent('error', 'cron.exception', { route, cause });
    const report = buildReport(start, { ok: false, route, error: `Job ownership, storage or time budget unavailable; inspect the ingestion report and explicitly rerun. Cause: ${cause}` });
    logReport(report);
    return Response.json(report, { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } });
  }
}
