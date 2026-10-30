import {
  ProviderError,
  withProviderDeadline,
  type ProviderRequestOptions,
} from "../transport";
import {
  completeJolpicaAdmission,
  createJolpicaSharedAdmission,
  jolpicaAdmissionOwner,
  jolpicaRedisConfig,
  type JolpicaSharedAdmission,
} from "./shared-admission";
import { resolveProviderBase } from "../provider-base";
import { BUILD_QUEUE_ALLOWANCE_MS, BUILD_READ_STORE_ENV, isBuildPhase } from "../build-phase";
import { createDiskBuildStore, type JolpicaBuildStore } from "./build-store";
import { defaultJolpicaLastGoodStore, jolpicaKeyIsImmutable, type JolpicaLastGoodStore } from "./last-good";
import { JOLPICA_MAX_BACKOFF_MS } from "./shared-admission";

/** How long an expired, validated copy may still be served while Jolpica is failing. */
export const JOLPICA_STALE_IF_ERROR_MS = 6 * 3_600_000;
/** How long one failed read is remembered before the same key may try again. */
export const JOLPICA_FAILURE_COOLDOWN_MS = 30_000;
/**
 * Default pause after an HTTP 429 that carried no Retry-After header (F-02:
 * was 60 s for every endpoint). Jolpica's burst limit clears within seconds;
 * an exhausted hourly quota answers with Retry-After, which is honoured.
 */
export const JOLPICA_RATE_LIMIT_COOLDOWN_MS = 15_000;

/** How long a 429 pauses its endpoint class: Retry-After when sent, bounded to [1 s, JOLPICA_MAX_BACKOFF_MS]. */
export function jolpicaRateLimitPauseMs(error: ProviderError): number {
  return Math.min(JOLPICA_MAX_BACKOFF_MS, Math.max(1_000, error.retryAfterMs ?? JOLPICA_RATE_LIMIT_COOLDOWN_MS));
}

const RESOURCE_CLASS: Record<string, string> = {
  driverStandings: "standings", constructorStandings: "standings", results: "results", qualifying: "qualifying",
  sprint: "sprint", laps: "laps", pitstops: "pitstops", seasons: "seasons", circuits: "circuits",
  drivers: "drivers", constructors: "constructors", status: "status",
};
/**
 * The endpoint class a 429 pauses (F-02): one rate-limited standings read no
 * longer refuses schedule, results or identity reads in this process or, via
 * the shared backoff key, in every other instance.
 */
export function jolpicaRateLimitScope(key: string): string {
  let path = key;
  try { path = new URL(key).pathname; } catch { /* a bare test key */ }
  const segments = path.replace(/\.json$/, "").split("/").filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const found = RESOURCE_CLASS[segments[i]!];
    if (found) return found;
  }
  return "schedule";
}

function isRateLimited(error: unknown): error is ProviderError {
  return error instanceof ProviderError && (error.code === "rate-limit" || (error.code === "http" && error.status === 429));
}

/** Failures worth remembering: the provider (not the caller) is unhealthy. */
function isProviderFailure(error: unknown): error is ProviderError {
  return error instanceof ProviderError && (error.code === "http" || error.code === "network" || error.code === "timeout" || error.code === "rate-limit");
}

export interface JolpicaReadOptions extends ProviderRequestOptions {
  fresh?: boolean;
  /** Internal: a retry of a read that just failed may bypass the failure cache once. */
  retryAttempt?: boolean;
  /** Endpoint class for 429 pauses; derived from the key when omitted. */
  rateScope?: string;
  /** Opt-in older fallback while Jolpica is unavailable (see JolpicaStaleFallback). */
  staleFallback?: JolpicaStaleFallback;
}

/**
 * A caller that only needs slowly-changing data (the season calendar for a
 * cron job) may accept a validated copy older than the normal stale-if-error
 * window while Jolpica is unavailable, and is told when one was served so it
 * can report it. Pages never pass this.
 */
export interface JolpicaStaleFallback {
  /** Oldest acceptable copy, measured from when it was validated. */
  maxAgeMs: number;
  /** Called with the copy's validation time whenever a fallback copy answers the read. */
  onServed?(storedAt: number): void;
}

/** Validated process cache plus mandatory account-wide admission when configured. */
export class JolpicaRequestControl {
  private lane: Promise<void> = Promise.resolve();
  private lastStart = -Infinity;
  private starts: number[] = [];
  private pending = new Map<string, Promise<unknown>>();
  private cache = new Map<
    string,
    {
      value: unknown;
      storedAt: number;
      requestId: number;
      expires: number;
      staleUntil: number;
      bytes: number;
    }
  >();
  /** Negative cache: recent provider failures per key, so an outage does not
   * turn every page view into new upstream attempts. */
  private failures = new Map<string, { until: number; error: ProviderError }>();
  /** Pause per endpoint class after a 429 (Retry-After when the provider sent one). */
  private cooldowns = new Map<string, number>();
  private cacheBytes = 0;
  private generation = 0;
  private requestSequence = 0;
  constructor(
    private readonly config: {
      now?: () => number;
      sleep?: (ms: number) => Promise<void>;
      maxStartsPerHour?: number;
      sharedAdmission?: JolpicaSharedAdmission | null;
      requireShared?: boolean;
      staleIfErrorMs?: number;
      failureCooldownMs?: number;
      /** True while `next build` prerenders (default: NEXT_PHASE). */
      buildPhase?: () => boolean;
      /** Per-build store shared by build workers (only consulted during the build). */
      buildStore?: JolpicaBuildStore | null;
      /** Cross-instance last-good copies served while reads are refused (F-02). */
      lastGood?: JolpicaLastGoodStore | null;
    } = {},
  ) {}

  private building(): boolean {
    return (this.config.buildPhase ?? (() => isBuildPhase()))();
  }

  private cooldownUntil(scope: string): number {
    const until = this.cooldowns.get(scope);
    if (until === undefined) return -Infinity;
    if (until <= this.now()) { this.cooldowns.delete(scope); return -Infinity; }
    return until;
  }

  private now() {
    return (this.config.now ?? Date.now)();
  }

  /** Physical requests started in the last hour by this process. */
  get startsInLastHour(): number {
    const cutoff = this.now() - 3_600_000;
    return this.starts.filter((time) => time > cutoff).length;
  }

  /** Expire selected local copies without resetting pacing or in-flight requests. */
  invalidate(matches: (key: string) => boolean): void {
    this.generation++;
    for (const [key, entry] of this.cache) {
      if (!matches(key)) continue;
      this.cacheBytes -= entry.bytes;
      this.cache.delete(key);
    }
    for (const key of this.failures.keys()) if (matches(key)) this.failures.delete(key);
  }

  private sleep(ms: number) {
    return (this.config.sleep ?? ((wait) => new Promise<void>((resolve) => setTimeout(resolve, wait))))(ms);
  }

  private async schedule<T>(
    operation: () => Promise<T>,
    signal: AbortSignal,
    expires: number,
    scope: string,
  ): Promise<T> {
    const previous = this.lane;
    let releaseLane!: () => void;
    this.lane = new Promise<void>((resolve) => {
      releaseLane = resolve;
    });
    let sharedOwner: string | undefined;
    let rateLimited: ProviderError | undefined;
    try {
      await previous;
      if (signal.aborted || this.now() >= expires)
        throw new ProviderError("jolpica", "timeout");
      const paused = this.cooldownUntil(scope);
      if (paused > this.now())
        throw new ProviderError("jolpica", "rate-limit", undefined, paused - this.now());
      this.starts = this.starts.filter((time) => time > this.now() - 3_600_000);
      if (this.starts.length >= (this.config.maxStartsPerHour ?? 500))
        throw new ProviderError("jolpica", "rate-limit");
      const delay = Math.max(0, this.lastStart + 260 - this.now());
      if (this.now() + delay >= expires)
        throw new ProviderError("jolpica", "timeout");
      if (delay) await this.sleep(delay);
      if (signal.aborted || this.now() >= expires)
        throw new ProviderError("jolpica", "timeout");
      const shared = this.config.sharedAdmission;
      if (this.config.requireShared && !shared)
        throw new ProviderError("jolpica", "configuration");
      if (shared) {
        const owner = jolpicaAdmissionOwner();
        for (;;) {
          if (signal.aborted || this.now() >= expires)
            throw new ProviderError("jolpica", "timeout");
          const reservation = await shared.reserve(owner, signal, scope);
          if (reservation.admitted) {
            sharedOwner = owner;
            if (
              reservation.remainingMs < expires - this.now() + 10 ||
              signal.aborted
            )
              throw new ProviderError("jolpica", "timeout");
            break;
          }
          if (
            this.now() + reservation.retryMs >= expires &&
            reservation.retryMs > 35000
          )
            throw new ProviderError("jolpica", "rate-limit");
          const wait = Math.min(260, Math.max(1, reservation.retryMs));
          if (this.now() + wait >= expires)
            throw new ProviderError("jolpica", "timeout");
          await this.sleep(wait);
        }
      }
      if (signal.aborted || this.now() >= expires)
        throw new ProviderError("jolpica", "timeout");
      this.lastStart = this.now();
      this.starts.push(this.lastStart);
      // Only the start gap paces requests. The next queued read may start
      // 260 ms later while this transport is still running.
      releaseLane();
      const started = this.now();
      try {
        const result = await operation();
        return result;
      } catch (error) {
        if (isRateLimited(error)) rateLimited = error;
        // One line per failed physical read, so production logs say why a page lost its data.
        if (error instanceof ProviderError)
          console.warn(JSON.stringify({ event: "provider.jolpica.failure", scope, code: error.code, status: error.status ?? null, ms: Math.round(this.now() - started) }));
        throw error;
      }
    } finally {
      releaseLane();
      if (rateLimited) {
        const pause = jolpicaRateLimitPauseMs(rateLimited);
        this.cooldowns.set(scope, Math.max(this.cooldownUntil(scope), this.now() + pause));
      }
      const shared = this.config.sharedAdmission;
      if (sharedOwner && shared) {
        try {
          // Every ended transport frees its lease at once, failure, timeout or abort: an aborted
          // fetch has closed its connection, and Jolpica's limits count starts, which the quota
          // and start gap enforce. Kept leases let three timed-out reads block every other read
          // for 35 s (production, 2026-10-26). Only a 429 keeps its lease, beside the backoff.
          if (!rateLimited)
            await completeJolpicaAdmission(shared, sharedOwner);
          if (rateLimited && shared.backoff)
            await withProviderDeadline("jolpica", (backoffSignal) => shared.backoff!(jolpicaRateLimitPauseMs(rateLimited!), backoffSignal, scope), { timeoutMs: 2000 });
        } catch {
          // Lease bookkeeping is bounded by its own expiry; never mask the read result.
        }
      }
    }
  }

  private remember(
    key: string,
    value: unknown,
    ttlSeconds: number,
    requestId: number,
  ): void {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > 2_000_000) return;
    const existing = this.cache.get(key);
    // A slower, older request cannot replace a newer observation.
    if (existing && existing.requestId > requestId) return;
    if (existing) {
      this.cacheBytes -= existing.bytes;
      this.cache.delete(key);
    }
    const now = this.now();
    for (const [entryKey, entry] of this.cache)
      if (entry.staleUntil <= now) {
        this.cacheBytes -= entry.bytes;
        this.cache.delete(entryKey);
      }
    while (this.cache.size >= 64 || this.cacheBytes + bytes > 16_000_000) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cacheBytes -= this.cache.get(oldest)!.bytes;
      this.cache.delete(oldest);
    }
    const expires = now + Math.min(ttlSeconds, 86_400) * 1000;
    this.cache.set(key, {
      value: structuredClone(value),
      storedAt: now,
      requestId,
      expires,
      staleUntil: expires + (this.config.staleIfErrorMs ?? JOLPICA_STALE_IF_ERROR_MS),
      bytes,
    });
    this.cacheBytes += bytes;
    this.failures.delete(key);
  }

  /** A validated copy that is past its TTL but inside the stale-if-error window (or the caller's longer one). */
  private stale<T>(key: string, maxAgeMs?: number): { value: T; storedAt: number } | undefined {
    const cached = this.cache.get(key);
    if (!cached) return undefined;
    const usable = cached.staleUntil > this.now() || (maxAgeMs !== undefined && this.now() - cached.storedAt <= maxAgeMs);
    if (!usable) return undefined;
    return { value: structuredClone(cached.value) as T, storedAt: cached.storedAt };
  }

  private noteFailure(key: string, error: unknown): void {
    if (!isProviderFailure(error)) return;
    const cooldown = isRateLimited(error)
      ? jolpicaRateLimitPauseMs(error)
      : (this.config.failureCooldownMs ?? JOLPICA_FAILURE_COOLDOWN_MS);
    this.failures.set(key, { until: this.now() + cooldown, error });
    if (this.failures.size > 256) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }

  /** The cross-instance last-good copy, inside the window this key may be served stale (F-02). */
  private async lastGood<T>(key: string, maxAgeMs?: number): Promise<{ value: T; storedAt: number } | undefined> {
    const store = this.config.lastGood;
    if (!store) return undefined;
    const entry = await store.read(key).catch(() => null);
    if (!entry) return undefined;
    const window = jolpicaKeyIsImmutable(key, this.now())
      ? Number.POSITIVE_INFINITY
      : Math.max(this.config.staleIfErrorMs ?? JOLPICA_STALE_IF_ERROR_MS, maxAgeMs ?? 0);
    if (this.now() - entry.storedAt > window) return undefined;
    return { value: structuredClone(entry.value) as T, storedAt: entry.storedAt };
  }

  /** Process copy first, then the shared last-good copy; tells an opted-in caller it was served. */
  private async fallback<T>(key: string, stale?: JolpicaStaleFallback): Promise<T | undefined> {
    const maxAgeMs = stale && Number.isFinite(stale.maxAgeMs) && stale.maxAgeMs > 0 ? stale.maxAgeMs : undefined;
    const copy = this.stale<T>(key, maxAgeMs) ?? (await this.lastGood<T>(key, maxAgeMs));
    if (!copy) return undefined;
    try { stale?.onServed?.(copy.storedAt); } catch { /* reporting only */ }
    return copy.value;
  }

  async readThrough<T>(
    key: string,
    ttlSeconds: number,
    opts: JolpicaReadOptions,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (opts.signal?.aborted) throw new ProviderError("jolpica", "timeout");
    const cached = this.cache.get(key);
    if (
      !opts.fresh &&
      ttlSeconds > 0 &&
      cached &&
      cached.expires > this.now() &&
      this.now() - cached.storedAt < ttlSeconds * 1000
    )
      return structuredClone(cached.value) as T;
    const scope = opts.rateScope ?? jolpicaRateLimitScope(key);
    const building = this.building();
    // Revalidation disabled means a fresh observation, even if an earlier render is in flight.
    const unshared = opts.fresh === true || ttlSeconds === 0;
    if (!unshared && !opts.retryAttempt) {
      // During an outage, answer from memory instead of sending new attempts:
      // the last validated copy if one is recent enough (this process, else
      // any instance), else the remembered failure. A paused endpoint class
      // with no copy queues below when its pause ends inside the budget.
      const failure = this.failures.get(key);
      const failing = Boolean(failure && failure.until > this.now());
      if (failing || this.cooldownUntil(scope) > this.now()) {
        const copy = await this.fallback<T>(key, opts.staleFallback);
        if (copy !== undefined) return copy;
        if (failing) throw failure!.error;
      }
    }
    const requestId = ++this.requestSequence;
    const pendingKey = unshared ? `${key}\0fresh:${requestId}` : key;
    let work = this.pending.get(pendingKey) as Promise<T> | undefined;
    if (!work) {
      // During `next build` a read may also wait in the queue (F-01); its
      // transport timeout is enforced by the caller from the transport start.
      const ceiling = 30_000 + (building ? BUILD_QUEUE_ALLOWANCE_MS : 0);
      const duration = Number.isFinite(opts.timeoutMs)
        ? Math.max(1, Math.min(opts.timeoutMs!, ceiling))
        : 8_000;
      const expires = this.now() + duration;
      // Set once the physical request starts. A failure before that (this
      // process's own start queue, budget or cooldown) says nothing about
      // Jolpica's health and is never remembered as a provider failure (R3-CODE-4).
      let started = false;
      const buildStore = building && !unshared ? this.config.buildStore ?? null : null;
      // A shared read retains its own deadline when one caller leaves. A fresh
      // observation has no other waiters, so cancellation also stops its actual
      // transport and prevents queued work from starting afterward.
      work = withProviderDeadline(
        "jolpica",
        async (signal) => {
          let claimed = false;
          if (buildStore) {
            // Another build worker may already have this response, or be fetching it.
            const stored = await buildStore.claimOrWait(key, Date.now() + Math.max(0, expires - this.now()), signal).catch(() => null);
            if (stored) return stored.value as T;
            claimed = true;
          }
          let written = false;
          try {
            // Queue rather than fail (F-02): a paused endpoint class is waited
            // out when its pause ends inside this read's budget.
            for (;;) {
              const paused = this.cooldownUntil(scope);
              if (paused <= this.now()) break;
              if (paused + 50 >= expires || signal.aborted)
                throw new ProviderError("jolpica", "rate-limit", undefined, paused - this.now());
              await this.sleep(paused - this.now());
            }
            const value = await this.schedule(() => { started = true; return operation(signal); }, signal, expires, scope);
            if (buildStore) { await buildStore.write(key, value).catch(() => undefined); written = true; }
            return value;
          } finally {
            if (claimed && !written) await buildStore!.release(key).catch(() => undefined);
          }
        },
        { timeoutMs: duration, signal: unshared ? opts.signal : undefined },
      );
      this.pending.set(pendingKey, work);
      const current = work;
      const generation = this.generation;
      void current
        .then(
          (value) => {
            if (generation !== this.generation) return;
            this.remember(key, value, ttlSeconds, requestId);
            // Shared last-good copy for cold instances (F-02); best effort, never awaited by the page.
            if (!unshared && started && this.config.lastGood)
              void this.config.lastGood.write(key, { storedAt: this.now(), value }).catch(() => undefined);
          },
          (error) => {
            if (!unshared && started) this.noteFailure(key, error);
          },
        )
        .finally(() => {
          if (this.pending.get(pendingKey) === current)
            this.pending.delete(pendingKey);
        })
        .catch(() => undefined);
    }
    try {
      const value = await withProviderDeadline("jolpica", () => work!, opts);
      return structuredClone(value);
    } catch (error) {
      // Stale-if-error: a validated copy from the last few hours beats an
      // unavailable page when Jolpica is down or rate-limited. Strict fresh
      // observations (ingestion, revalidate:0) never accept an old copy.
      if (!unshared && isProviderFailure(error)) {
        const copy = await this.fallback<T>(key, opts.staleFallback);
        if (copy !== undefined) return copy;
      }
      throw error;
    }
  }
}

const processGlobals = globalThis as typeof globalThis & {
  __apexJolpicaRequestControl?: JolpicaRequestControl;
};
const sharedConfig = jolpicaRedisConfig();
/** Same rule as client.ts: only a loopback development cache counts (never on Vercel). */
const jolpicaBaseOverridden = resolveProviderBase("JOLPICA_BASE_URL", "https://api.jolpi.ca/ergast/f1", process.env, () => undefined).overridden;
export const jolpicaRequestControl =
  (processGlobals.__apexJolpicaRequestControl ??= new JolpicaRequestControl({
    sharedAdmission: sharedConfig
      ? createJolpicaSharedAdmission(sharedConfig)
      : null,
    // In development behind scripts/dev/provider-cache.mjs, the cache enforces
    // Jolpica's real hourly budget for every local server, and cache hits never
    // reach Jolpica, so the per-process budget would only starve local servers.
    maxStartsPerHour: jolpicaBaseOverridden ? Number.POSITIVE_INFINITY : undefined,
    // `next build` workers share one store per build (F-01); never at runtime.
    buildStore: isBuildPhase() && process.env[BUILD_READ_STORE_ENV]
      ? createDiskBuildStore(process.env[BUILD_READ_STORE_ENV]!)
      : null,
    // Last-good copies shared by every instance while reads are refused (F-02).
    lastGood: defaultJolpicaLastGoodStore(),
    // A local production build behind the loopback dev cache is paced by that
    // cache instead of requiring the shared (Upstash) admission store.
    requireShared:
      !jolpicaBaseOverridden &&
      (process.env.NODE_ENV === "production" ||
        Boolean(
          process.env.UPSTASH_REDIS_REST_URL ||
          process.env.UPSTASH_REDIS_REST_TOKEN,
        )),
  }));
