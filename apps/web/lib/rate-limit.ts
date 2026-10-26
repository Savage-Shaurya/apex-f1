import { createHash } from 'node:crypto';
/**
 * Lightweight, dependency-free fixed-window rate limiter for public API routes.
 *
 * Scope + caveats:
 *   - State lives in-process (a Map). On Vercel serverless / multi-instance this
 *     is PER-INSTANCE, so the effective global limit is `limit × instances`.
 *     KNOWN GAP: on 2026-07-28, 8 requests against a limit of 5 produced zero
 *     429s in production. Treat this as a coarse flood brake only. For a real
 *     global quotas sensitive mutations use rateLimitShared in distributed-rate-limit.ts.
 *   - Vercel hosting trusts its platform-specific forwarded IP header. Other
 *     hosting uses a shared unattributed identity until trusted proxy support is added.
 *
 * Usage:
 *   const rl = rateLimit(req, { limit: 5, windowMs: 60_000, bucket: 'predict' });
 *   if (!rl.ok) return tooMany(rl);
 */

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Namespace so different routes don't share counters. */
  bucket: string;
  /**
   * Count per this subject instead of per client IP (for example a verified
   * prediction identity). Hashed before use; never logged.
   */
  subject?: string;
}

/** Counter subject: the caller's explicit subject (hashed), else the client IP. */
export function rateLimitSubject(req: Request, opts: Pick<RateLimitOptions, 'subject'>): string {
  if (opts.subject === undefined) return clientIp(req);
  if (!opts.subject || opts.subject.length > 512) throw new TypeError('Invalid rate limit subject');
  return `s-${createHash('sha256').update(opts.subject).digest('hex').slice(0, 32)}`;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetAt: number;
  /** Seconds the caller should wait before retrying (only meaningful when !ok). */
  retryAfter: number;
}

interface Entry {
  count: number;
  resetAt: number;
}

// Module-scoped store. Survives between requests on a warm instance.
const store = new Map<string, Entry>();
const MAX_ENTRIES = 10_000;

// Opportunistic sweep so the Map can't grow unbounded from one-off IPs.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}

/**
 * Trust the Vercel-specific header only in a Vercel process. Direct hosting
 * cannot treat user-supplied forwarding headers as identity. Unattributable
 * traffic shares one quota instead of minting arbitrary independent counters.
 */
export function clientIp(req: Request): string {
  // Arbitrary proxy headers are client-controlled on a direct/non-Vercel host.
  if (process.env.VERCEL === "1") {
    const ip = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
    if (ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)) return ip;
  }
  return "unattributed";
}

export function rateLimit(
  req: Request,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const key = `${opts.bucket}:${rateLimitSubject(req, opts)}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + opts.windowMs;
    // Do not evict active limits under an identity flood: that would reopen quotas.
    if (!existing && store.size >= MAX_ENTRIES) {
      return {
        ok: false,
        limit: opts.limit,
        remaining: 0,
        resetAt,
        retryAfter: Math.ceil(opts.windowMs / 1_000),
      };
    }
    store.set(key, { count: 1, resetAt });
    return {
      ok: true,
      limit: opts.limit,
      remaining: opts.limit - 1,
      resetAt,
      retryAfter: 0,
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, opts.limit - existing.count);
  const ok = existing.count <= opts.limit;
  return {
    ok,
    limit: opts.limit,
    remaining,
    resetAt: existing.resetAt,
    retryAfter: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Standard 429 response with rate-limit headers. */
export function tooMany(result: RateLimitResult): Response {
  return new Response(JSON.stringify({ ok: false, error: "rate limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "retry-after": String(result.retryAfter),
      "x-ratelimit-limit": String(result.limit),
      "x-ratelimit-remaining": String(result.remaining),
      "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
    },
  });
}
