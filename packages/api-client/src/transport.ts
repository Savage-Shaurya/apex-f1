/** Redacted failures: never include credential-bearing URLs or upstream bodies. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: 'http' | 'timeout' | 'network' | 'invalid-response' | 'configuration' | 'incomplete' | 'invalid-input' | 'rate-limit' | 'redirect',
    readonly status?: number,
    /** Server-requested wait (HTTP Retry-After), when the provider sent one. */
    readonly retryAfterMs?: number,
    /**
     * Who answered a failed HTTP request: 'provider' when the body is the
     * provider's own JSON error (our request was rejected), 'edge' when it is
     * a CDN/proxy page or empty (the provider never answered it).
     */
    readonly origin?: 'provider' | 'edge',
  ) {
    super(`${provider}: ${code}${status === undefined ? '' : ` (HTTP ${status})`}`);
    this.name = 'ProviderError';
  }
}

/**
 * Why a provider read failed (cron resilience, 2026-10-31):
 *  - provider-unavailable: the provider or its edge is down, overloaded or
 *    rate-limiting (timeouts, dropped connections, 408/425/429, 5xx, a quota
 *    reply such as YouTube's quotaExceeded, and a 400/403 whose body is a
 *    CDN/edge page rather than the provider's own JSON). Temporary; retry later.
 *    A 404/405/410/422 is never an outage, whoever answered: the path is ours.
 *  - request-rejected: the provider itself refused our request (its JSON 4xx).
 *  - configuration: credentials or settings (401/403 from the provider, bad config).
 *  - invalid-data: the provider answered with data that fails validation.
 *  - internal: anything that is not a provider failure (our own bug).
 *  - redis-unavailable: Upstash refused or failed (quota, auth, outage); callers
 *    degrade to process-local behaviour (redis-guard.ts).
 */
export type ProviderFailureClass = 'provider-unavailable' | 'request-rejected' | 'configuration' | 'invalid-data' | 'internal' | 'redis-unavailable';

export function classifyProviderFailure(error: unknown): ProviderFailureClass {
  // Upstash (quota, auth, outage) is optional infrastructure, never a provider outage
  // and never fatal (redis-guard.ts). Matched by name: redis-guard imports this module.
  if (error instanceof Error && error.name === 'RedisUnavailableError') return 'redis-unavailable';
  if (!(error instanceof ProviderError)) return 'internal';
  switch (error.code) {
    case 'timeout': case 'network': case 'rate-limit': return 'provider-unavailable';
    case 'configuration': return 'configuration';
    // A permanent move (301/308 under redirect:'error') is ours to follow up, never an outage (review F-01).
    case 'invalid-input': case 'redirect': return 'request-rejected';
    case 'invalid-response': case 'incomplete': return 'invalid-data';
    case 'http': {
      const status = error.status ?? 0;
      if (status === 408 || status === 425 || status === 429 || status >= 500) return 'provider-unavailable';
      if (status === 401) return 'configuration';
      if ((status === 400 || status === 403) && error.origin === 'edge') return 'provider-unavailable';
      return status === 403 ? 'configuration' : 'request-rejected';
    }
    default: return 'internal';
  }
}

/** True only for a temporary upstream outage, never for our bug, auth/config or invalid data. */
export function isProviderUnavailable(error: unknown): boolean {
  return classifyProviderFailure(error) === 'provider-unavailable';
}

/** Google APIs (YouTube Data) answer a spent daily quota or a burst limit with 403 + one of these reasons. */
const QUOTA_REASONS = new Set(['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']);

function quotaReason(parsed: Record<string, unknown>): boolean {
  const error = parsed.error;
  if (!isRecord(error) || !Array.isArray(error.errors)) return false;
  return error.errors.some((entry) => isRecord(entry) && typeof entry.reason === 'string' && QUOTA_REASONS.has(entry.reason));
}

/** Longest wait for the one body read a failed response can need: a JSON 403 that may be a quota reply. */
export const QUOTA_PEEK_MS = 250;

/**
 * Who answered a failed request, from the content type alone (review F-04):
 * JSON is the provider's own answer (our request was refused), anything else
 * (HTML, text, no type) is a CDN/edge page. No body is read for that, so a
 * failed read adds no latency to page renders (review F-06). Only a JSON 403
 * is peeked at (4 KB, 250 ms) for a quota reason; the body is never kept.
 */
async function failureOrigin(response: Response, signal: AbortSignal): Promise<{ origin: 'provider' | 'edge'; quota: boolean }> {
  const json = /^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(response.headers.get('content-type') ?? '');
  if (!json || response.status !== 403) {
    void response.body?.cancel().catch(() => undefined);
    return { origin: json ? 'provider' : 'edge', quota: false };
  }
  const timer = new AbortController();
  const stop = setTimeout(() => timer.abort(), QUOTA_PEEK_MS);
  try {
    const parsed = JSON.parse(await readLimitedText(response, 4_096, AbortSignal.any([signal, timer.signal]))) as unknown;
    return { origin: 'provider', quota: isRecord(parsed) && quotaReason(parsed) };
  } catch {
    return { origin: 'provider', quota: false };
  } finally {
    clearTimeout(stop);
  }
}

/**
 * The redacted error for a non-2xx response, with who answered it (provider
 * JSON vs edge page) and a provider quota reply turned into 'rate-limit'.
 * For transports that do not use requestJson (RSS, YouTube streaming reads).
 */
export async function providerHttpError(provider: string, response: Response, signal: AbortSignal): Promise<ProviderError> {
  const retryAfter = retryAfterMs(response.headers.get('retry-after'));
  const { origin, quota } = await failureOrigin(response, signal);
  return quota
    ? new ProviderError(provider, 'rate-limit', response.status, retryAfter, origin)
    : new ProviderError(provider, 'http', response.status, retryAfter, origin);
}

/** Parse an HTTP Retry-After header (delta-seconds or HTTP-date), capped at one hour. */
export function retryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  let ms: number;
  if (/^\d+$/.test(trimmed)) ms = Number(trimmed) * 1000;
  else {
    const at = Date.parse(trimmed);
    if (!Number.isFinite(at)) return undefined;
    ms = at - now;
  }
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 3_600_000) : undefined;
}


/**
 * The platform fetch, without Next's instrumentation. Next patches
 * `globalThis.fetch` to add its Data Cache and to mark a render dynamic for
 * `cache: 'no-store'`. Validated-only providers (Jolpica, the Upstash
 * admission store) must be neither: an unvalidated body must never be
 * persisted, and an uncached control request must not turn a statically
 * prerendered (ISR) page into a per-request render. The page's own
 * `revalidate` then governs freshness. Outside Next this is plain fetch.
 */
export function untrackedFetch(): typeof fetch {
  const current = globalThis.fetch as typeof fetch & { _nextOriginalFetch?: typeof fetch };
  return current._nextOriginalFetch ?? current;
}

export interface ProviderRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Next.js signals static-render bailouts, redirects and not-found with thrown
 * errors carrying a `digest` (DYNAMIC_SERVER_USAGE, NEXT_REDIRECT,
 * NEXT_HTTP_ERROR_FALLBACK, BAILOUT_TO_CLIENT_SIDE_RENDERING, ...). They are
 * control flow, not provider failures: converting one into a ProviderError
 * turned every prerender into an "unavailable" page and made the whole site
 * dynamic. This package stays framework-free, so it recognises the shape.
 */
export function isFrameworkControlError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^(?:DYNAMIC_SERVER_USAGE|NEXT_|BAILOUT_TO_CLIENT_SIDE_RENDERING|HANGING_PROMISE_REJECTION)/.test(digest);
}

export function failOr<T>(provider: string, error: unknown, strict: boolean | undefined, fallback: T): T {
  if (isFrameworkControlError(error)) throw error;
  if (strict) throw error instanceof ProviderError ? error : new ProviderError(provider, 'invalid-response');
  return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readLimitedText(response: Response, maxBytes = 2_000_000, signal?: AbortSignal): Promise<string> {
  maxBytes = Number.isFinite(maxBytes) ? Math.max(1, Math.min(maxBytes, 16_000_000)) : 2_000_000;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ProviderError('response', 'invalid-response');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new ProviderError('response', 'timeout');
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ProviderError('response', 'invalid-response');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Deadline covers connection and complete response body, including fetch mocks. */
export async function withProviderDeadline<T>(
  provider: string,
  operation: (signal: AbortSignal) => Promise<T>,
  options: ProviderRequestOptions = {},
): Promise<T> {
  if (options.signal?.aborted) throw new ProviderError(provider, 'timeout');
  const controller = new AbortController();
  const duration = options.timeoutMs ?? 8_000;
  const timeoutMs = Number.isFinite(duration) ? Math.max(1, Math.min(duration, 120_000)) : 8_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const fail = () => { controller.abort(); reject(new ProviderError(provider, 'timeout')); };
    timer = setTimeout(fail, timeoutMs);
    onAbort = fail;
    if (options.signal?.aborted) fail();
    else options.signal?.addEventListener('abort', fail, { once: true });
  });
  try {
    return await Promise.race([operation(controller.signal), interrupted]);
  } catch (error) {
    if (isFrameworkControlError(error) || error instanceof ProviderError) throw error;
    // Only a real transport failure becomes a provider error; anything else is our own
    // bug and is rethrown unchanged (classified 'internal', red) (review F-01).
    throw transportFailure(provider, error) ?? error;
  } finally {
    clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/** Socket-level failures that mean "the other side is unreachable right now". */
const NETWORK_FAILURE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED',
]);
/** TLS and certificate failures: a configuration problem on one side, never a passing outage. */
const TLS_FAILURE_CODE = /^(?:CERT_|UNABLE_TO_(?:GET|VERIFY|DECRYPT)|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_|ERR_SSL_|ERR_OSSL_|HOSTNAME_MISMATCH)/;

/**
 * Map a thrown fetch error to a provider failure, or null when it is not a
 * transport failure at all (review F-01): an abort/timeout or a socket error
 * (DNS, reset, refused, closed) is 'timeout'/'network'; a refused redirect
 * (undici "unexpected redirect" under redirect:'error') is 'redirect'; a TLS
 * or certificate error is 'configuration'. Follows up to four `cause` links.
 */
function transportFailure(provider: string, error: unknown): ProviderError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const record = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (record.name === 'AbortError' || record.name === 'TimeoutError') return new ProviderError(provider, 'timeout');
    if (typeof record.code === 'string') {
      if (TLS_FAILURE_CODE.test(record.code)) return new ProviderError(provider, 'configuration');
      if (NETWORK_FAILURE_CODES.has(record.code)) return new ProviderError(provider, 'network');
    }
    if (depth > 0 && typeof record.message === 'string' && /^(?:unexpected redirect|redirect count exceeded)$/i.test(record.message)) return new ProviderError(provider, 'redirect');
    current = record.cause;
  }
  return null;
}

export async function requestJson<T = unknown>(
  provider: string,
  url: string | URL,
  init: RequestInit,
  options: ProviderRequestOptions = {},
): Promise<T> {
  return withProviderDeadline(provider, async (signal) => {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), { redirect: 'error', ...init, signal });
    if (!response.ok) throw await providerHttpError(provider, response, signal);
    const text = await readLimitedText(response, options.maxBytes, signal);
    try { return JSON.parse(text) as T; }
    catch { throw new ProviderError(provider, 'invalid-response'); }
  }, options);
}
