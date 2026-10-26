import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import { rateLimit, rateLimitSubject, type RateLimitOptions, type RateLimitResult } from './rate-limit';

export interface SharedRateLimitOptions extends RateLimitOptions {
  /**
   * Retained for existing public form callers. This never permits a local
   * replacement in deployment: all routes require an authoritative shared
   * quota there. Undeployed development retains its coarse local brake.
   */
  localFallback?: boolean;
}

export interface SharedRateLimitResult extends RateLimitResult {
  /** Whether a limiter made an authoritative decision (shared, or explicit local development). */
  available: boolean;
  store: 'upstash' | 'local' | 'unavailable';
}

const TIMEOUT_MS = 3_000;
const UNAVAILABLE_RETRY_SECONDS = 30;
const MAX_RESPONSE_BYTES = 4_096;

// One atomic operation: Redis owns the first-hit window and never extends it
// on subsequent requests. Saturating denied counts prevents unlimited growth.
const FIXED_WINDOW_SCRIPT = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', window)
  return {1, window}
end
if count < limit then
  count = redis.call('INCR', KEYS[1])
else
  count = limit + 1
end
return {count, ttl}
`;

function validateOptions(opts: RateLimitOptions): void {
  if (
    !Number.isSafeInteger(opts.limit) || opts.limit < 1 || opts.limit > 1_000_000 ||
    !Number.isSafeInteger(opts.windowMs) || opts.windowMs < 1 || opts.windowMs > 86_400_000 ||
    !/^[a-zA-Z0-9:_-]{1,128}$/.test(opts.bucket)
  ) {
    throw new TypeError('Invalid rate limit policy');
  }
}

function sharedConfig(): { url: string; token: string } | null {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!rawUrl || !token || token.length > 4_096 || !/^[a-zA-Z0-9._~+/-]+={0,2}$/.test(token)) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== 'https:' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.upstash\.io$/.test(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    ) {
      return null;
    }
    return { url: url.origin, token };
  } catch {
    return null;
  }
}

function mayUseLocalStore(): boolean {
  const required = process.env.DISTRIBUTED_RATE_LIMIT_REQUIRED?.trim().toLowerCase();
  // Unknown flag values fail closed rather than silently accepting a
  // misspelled requirement.
  const notRequired = required === undefined || required === '' || required === 'false';
  if (!notRequired) return false;
  // NODE_ENV alone is insufficient: a deployed development-mode process must
  // not get an in-memory replacement for a shared quota.
  return process.env.NODE_ENV === 'development' && !process.env.VERCEL && !process.env.VERCEL_ENV;
}

function unavailable(req: Request, opts: SharedRateLimitOptions): SharedRateLimitResult {
  if (mayUseLocalStore()) {
    return { ...rateLimit(req, opts), available: true, store: 'local' };
  }
  return {
    ok: false,
    limit: opts.limit,
    remaining: 0,
    resetAt: Date.now() + UNAVAILABLE_RETRY_SECONDS * 1_000,
    retryAfter: UNAVAILABLE_RETRY_SECONDS,
    available: false,
    store: 'unavailable',
  };
}

async function readResult(response: Response, opts: RateLimitOptions, signal: AbortSignal): Promise<[number, number]> {
  if (!response.ok || !response.body) throw new Error('Rate limit store unavailable');
  if (signal.aborted) throw new Error('Rate limit store timed out');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error('Invalid rate limit response');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const data: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data) {
    throw new Error('Invalid rate limit response');
  }
  const result = (data as { result?: unknown }).result;
  if (!Array.isArray(result) || result.length !== 2) throw new Error('Invalid rate limit response');
  const [count, ttl] = result;
  if (
    !Number.isSafeInteger(count) || count < 1 || count > opts.limit + 1 ||
    !Number.isSafeInteger(ttl) || ttl < 1 || ttl > opts.windowMs
  ) {
    throw new Error('Invalid rate limit response');
  }
  return [count, ttl];
}

/**
 * Global fixed-window quota using the Upstash Redis REST API and atomic EVAL.
 * No network/config/error details are logged or returned. The full HTTP/body
 * operation is bounded to 3 seconds and redirects cannot forward credentials.
 * Set DISTRIBUTED_RATE_LIMIT_REQUIRED=true in production. Missing/broken shared
 * storage fails closed in every deployed environment, even if the flag is unset;
 * only explicit undeployed local development can use the existing coarse brake.
 */
export async function rateLimitShared(req: Request, opts: SharedRateLimitOptions): Promise<SharedRateLimitResult> {
  validateOptions(opts);
  const config = sharedConfig();
  if (!config) return unavailable(req, opts);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Rate limit store timed out'));
    }, TIMEOUT_MS);
  });
  try {
    const key = scopedRedisKey(`apex:rl:v1:${opts.bucket}:${opts.limit}:${opts.windowMs}:${rateLimitSubject(req, opts)}`);
    const operation = (async () => {
      const response = await fetch(config.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(['EVAL', FIXED_WINDOW_SCRIPT, '1', key, String(opts.limit), String(opts.windowMs)]),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      return readResult(response, opts, controller.signal);
    })();
    const [count, ttl] = await Promise.race([operation, deadline]);
    const ok = count <= opts.limit;
    return {
      ok,
      limit: opts.limit,
      remaining: Math.max(0, opts.limit - count),
      resetAt: Date.now() + ttl,
      retryAfter: ok ? 0 : Math.max(1, Math.ceil(ttl / 1_000)),
      available: true,
      store: 'upstash',
    };
  } catch {
    return unavailable(req, opts);
  } finally {
    clearTimeout(timer);
    // Also release a body stream on malformed data or a timed-out mock/fetch.
    controller.abort();
  }
}

/** A storage outage is 503; genuine shared/local quota exhaustion remains 429. */
export function rateLimitUnavailable(result: SharedRateLimitResult): Response {
  return new Response(JSON.stringify({ ok: false, error: 'rate limiter unavailable' }), {
    status: 503,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'retry-after': String(result.retryAfter),
    },
  });
}
