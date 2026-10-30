/** Test fixtures only (never imported by product code): every Upstash failure mode for the Redis-optional tests. */
export const UPSTASH_QUOTA_BODY = JSON.stringify({ error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500002' });
/** Every Upstash failure mode seen or plausible in production. */
export const REDIS_FAILURES = {
  quota: async () => new Response(UPSTASH_QUOTA_BODY, { status: 400, headers: { 'content-type': 'application/json' } }),
  auth: async () => Response.json({ error: 'WRONGPASS invalid password' }, { status: 401 }),
  server: async () => Response.json({ error: 'internal error' }, { status: 500 }),
  timeout: (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }),
  network: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }); },
  garbage: async () => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
} as const;
export type RedisFailureMode = keyof typeof REDIS_FAILURES;
