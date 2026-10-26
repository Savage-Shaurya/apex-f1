export interface Lease { key: string; token: string; expiresAt: string }
export interface LeaseStore {
  claim(input: { key: string; ttlSeconds: number }): Promise<Lease | null>;
  renew(lease: Lease, ttlSeconds: number): Promise<Lease | null>;
  release(lease: Lease): Promise<boolean>;
}
export interface JobContext {
  signal: AbortSignal;
  lease: Lease;
  expiresAt: number;
  assertActive(): void;
  remainingMs(): number;
  /** True when no durable lease owns this run (cache-only job, database unset or unreachable); fenced writes fail closed. */
  unleased?: boolean;
}
export class JobLeaseLostError extends Error {
  constructor() { super('Job ownership was lost; work stopped without reporting success.'); }
}
export class JobBudgetError extends Error {
  constructor() { super('Job time budget exhausted; remaining work is deferred.'); }
}

/** A single renewing owner; cancellation is cooperative and completion waits for cleanup.
 * Callers must pass the lease into durable source observations so database writes
 * also verify ownership atomically, rather than trusting this process timer alone.
 */
export async function runLeasedJob<T>(
  key: string,
  store: LeaseStore,
  task: (context: JobContext) => Promise<T>,
  options: {
    ttlSeconds?: number; renewEveryMs?: number; budgetMs?: number; signal?: AbortSignal;
    /**
     * Opt-in for tasks that stop at the time budget on their own and return an
     * honest partial report (committed work kept, the rest deferred). Such a
     * value is a completion flagged `budget: 'exhausted'`. A lost lease or an
     * external cancellation is never accepted this way.
     */
    acceptPartialOnBudget?: (value: T) => boolean;
  } = {},
): Promise<{ status: 'busy' } | { status: 'completed'; value: T; cleanup?: 'release-failed'; budget?: 'exhausted' }> {
  const ttlSeconds = options.ttlSeconds ?? 120;
  const renewEveryMs = options.renewEveryMs ?? Math.min(30_000, ttlSeconds * 250);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3_600 ||
      !Number.isInteger(renewEveryMs) || renewEveryMs < 1 || renewEveryMs >= ttlSeconds * 1_000 ||
      (options.budgetMs !== undefined && (!Number.isFinite(options.budgetMs) || options.budgetMs < 1)))
    throw new TypeError('Invalid job lease policy.');
  options.signal?.throwIfAborted();
  // Acquisition consumes the same absolute budget; slow storage cannot grant a
  // fresh full function window after the hosting clock has already advanced.
  const expiresAt = options.budgetMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.budgetMs;
  const lease = await store.claim({ key, ttlSeconds });
  if (!lease) return { status: 'busy' };
  const controller = new AbortController();
  let currentLease = lease;
  let stopped = false;
  let renewal: Promise<void> | null = null;
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  if (options.signal?.aborted) abortFromParent();
  const scheduleRenew = () => {
    if (stopped || controller.signal.aborted) return;
    renewTimer = setTimeout(() => {
      renewal = (async () => {
        try {
          const next = await store.renew(currentLease, ttlSeconds);
          if (!next || next.key !== lease.key || next.token !== lease.token) throw new JobLeaseLostError();
          currentLease = next;
        } catch { controller.abort(new JobLeaseLostError()); }
      })().finally(() => { renewal = null; scheduleRenew(); });
    }, renewEveryMs);
  };
  scheduleRenew();
  if (options.budgetMs !== undefined)
    budgetTimer = setTimeout(() => controller.abort(new JobBudgetError()), Math.max(0, expiresAt - Date.now()));
  const context: JobContext = {
    signal: controller.signal, lease, expiresAt,
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    assertActive() {
      controller.signal.throwIfAborted();
      if (Date.now() >= expiresAt) throw new JobBudgetError();
      if (Date.parse(currentLease.expiresAt) <= Date.now()) throw new JobLeaseLostError();
    },
  };
  // The task's own outcome (value or error) is kept apart from cleanup: a
  // failed lease release can neither discard finished work (a sent broadcast
  // reported as "rerun") nor hide the task's real error.
  let outcome: { ok: true; value: T; budget?: 'exhausted' } | { ok: false; error: unknown };
  try {
    context.assertActive();
    const value = await task(context);
    // Work that ignored a cancellation (lost lease, budget, shutdown) is not a
    // completion; work that finished before any abort is, and so is a partial
    // report from a task that opted in to stopping at its budget.
    if (controller.signal.aborted && controller.signal.reason instanceof JobBudgetError && options.acceptPartialOnBudget?.(value)) {
      outcome = { ok: true, value, budget: 'exhausted' };
    } else {
      controller.signal.throwIfAborted();
      outcome = { ok: true, value };
    }
  } catch (error) {
    outcome = { ok: false, error };
  }
  stopped = true;
  clearTimeout(renewTimer);
  clearTimeout(budgetTimer);
  controller.abort();
  options.signal?.removeEventListener('abort', abortFromParent);
  if (renewal) await renewal;
  let released = false;
  try { released = await store.release(currentLease); } catch { released = false; }
  if (!outcome.ok) throw outcome.error;
  // A release failure stays observable; lease expiry still permits recovery.
  return {
    status: 'completed', value: outcome.value,
    ...(released ? {} : { cleanup: 'release-failed' as const }),
    ...(outcome.budget ? { budget: outcome.budget } : {}),
  };
}
