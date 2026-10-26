/**
 * `next build` read policy (audit F-01).
 *
 * While Next prerenders, no visitor is waiting, but a single slow read used to
 * abort the whole deploy: a current-season standings read queued behind other
 * build reads for more than its 6 s render timeout, and the page threw. During
 * the build a provider read therefore:
 *   - may wait in the request queue (pacing, shared admission, a short 429
 *     cooldown) for up to BUILD_QUEUE_ALLOWANCE_MS on top of its own transport
 *     timeout, which then only measures the provider itself;
 *   - is retried with backoff when it fails transiently (timeout, network,
 *     5xx, 429), within that same bounded budget;
 *   - is shared by every build worker through the per-build read store, so
 *     each URL is fetched once per build instead of once per worker.
 * A read that still fails leaves its path out of the prebuild or renders the
 * honest unavailable state on a short revalidate (apps/web/lib/outage-connection.ts);
 * it never fails the build.
 */
type Env = Readonly<Record<string, string | undefined>>;

/** True while `next build` prerenders (Next sets NEXT_PHASE in every build worker). */
export function isBuildPhase(env: Env = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build';
}

/** Longest time one build read may wait in the queue, on top of its transport timeout. */
export const BUILD_QUEUE_ALLOWANCE_MS = 90_000;
/** Physical attempts one build read may make inside its budget. */
export const BUILD_READ_ATTEMPTS = 3;
/** Wait before build retry n (1-based): 1 s, then 3 s. */
export function buildRetryDelayMs(attempt: number): number {
  return attempt <= 1 ? 1_000 : 3_000;
}
/** Directory of this build's shared read store (set once by next.config.ts in the main build process). */
export const BUILD_READ_STORE_ENV = 'APEX_BUILD_READ_STORE';

/**
 * Budget of one provider read: the transport timeout always measures the
 * provider itself; the total adds the queue allowance only during the build.
 */
export function providerReadBudget(transportMs: number, building: boolean): { transportMs: number; totalMs: number } {
  return { transportMs, totalMs: transportMs + (building ? BUILD_QUEUE_ALLOWANCE_MS : 0) };
}
