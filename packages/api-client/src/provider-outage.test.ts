import http from 'node:http';
import { withProviderDeadline } from './transport';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError, classifyProviderFailure, isProviderUnavailable, requestJson } from './transport';
import { createJolpicaRedisTransport } from './jolpica/shared-admission';

// Cron resilience (2026-10-31): a Jolpica outage during a race weekend made every scheduled
// workflow fail red. An upstream outage must be told apart from our own bugs, auth/config and bad data.

const respond = (body: string, status: number, contentType: string) => (async () => new Response(body, { status, headers: { 'Content-Type': contentType } })) as typeof fetch;
const failureOf = async (fetchImpl: typeof fetch) => {
  try { await requestJson('jolpica', 'https://api.jolpi.ca/ergast/f1/current.json', {}, { fetchImpl, timeoutMs: 2_000 }); }
  catch (error) { return error; }
  assert.fail('request should have failed');
};

test('timeouts, dropped connections, 429, 408 and 5xx are provider-unavailable', () => {
  for (const error of [
    new ProviderError('jolpica', 'timeout'), new ProviderError('jolpica', 'network'), new ProviderError('jolpica', 'rate-limit'),
    new ProviderError('jolpica', 'http', 429), new ProviderError('jolpica', 'http', 408),
    new ProviderError('jolpica', 'http', 500), new ProviderError('jolpica', 'http', 502), new ProviderError('jolpica', 'http', 503),
    new ProviderError('jolpica', 'http', 504), new ProviderError('jolpica', 'http', 522), new ProviderError('openmeteo', 'timeout'),
  ]) {
    assert.equal(classifyProviderFailure(error), 'provider-unavailable', error.message);
    assert.equal(isProviderUnavailable(error), true);
  }
});

test('an edge 4xx (HTML or empty body on a valid path) is provider-unavailable', async () => {
  const html = await failureOf(respond('<!DOCTYPE html><title>400 Bad Request</title><center>cloudflare</center>', 400, 'text/html'));
  assert.ok(html instanceof ProviderError);
  assert.equal(html.status, 400);
  assert.equal(html.origin, 'edge');
  assert.equal(classifyProviderFailure(html), 'provider-unavailable');
  const empty = await failureOf(respond('', 400, 'text/plain'));
  assert.equal(classifyProviderFailure(empty), 'provider-unavailable');
});

test("the provider's own JSON 400 for a bad request is our fault, never an outage", async () => {
  // Jolpica's real answer to a malformed path (probed 2026-10-31).
  const ours = await failureOf(respond('{"detail":"Bad Request: Endpoint does not support final filter."}', 400, 'application/json'));
  assert.ok(ours instanceof ProviderError);
  assert.equal(ours.origin, 'provider');
  assert.equal(classifyProviderFailure(ours), 'request-rejected');
  assert.equal(isProviderUnavailable(ours), false);
  // A 400 with no origin information (constructed directly) is also not an outage.
  assert.equal(isProviderUnavailable(new ProviderError('jolpica', 'http', 400)), false);
  assert.equal(classifyProviderFailure(new ProviderError('jolpica', 'http', 404, undefined, 'provider')), 'request-rejected');
});

test('auth, configuration, invalid data and our own exceptions stay hard failures', () => {
  assert.equal(classifyProviderFailure(new ProviderError('upstash', 'http', 401, undefined, 'provider')), 'configuration');
  assert.equal(classifyProviderFailure(new ProviderError('jolpica', 'configuration')), 'configuration');
  assert.equal(classifyProviderFailure(new ProviderError('jolpica', 'invalid-input')), 'request-rejected');
  assert.equal(classifyProviderFailure(new ProviderError('jolpica', 'invalid-response')), 'invalid-data');
  assert.equal(classifyProviderFailure(new ProviderError('jolpica', 'incomplete')), 'invalid-data');
  assert.equal(classifyProviderFailure(new TypeError('x is undefined')), 'internal');
  assert.equal(classifyProviderFailure(undefined), 'internal');
  for (const error of [new ProviderError('jolpica', 'configuration'), new ProviderError('jolpica', 'invalid-response'), new TypeError('bug')])
    assert.equal(isProviderUnavailable(error), false);
});

test('the shared admission store (Upstash) reports its own failures, never as a Jolpica answer', async () => {
  const execute = createJolpicaRedisTransport(
    { url: 'https://fixture-db.upstash.io', token: 'synthetic-token' },
    { fetch: respond('{"error":"ERR max requests limit exceeded"}', 400, 'application/json') },
  );
  const error = await execute(['PING'], new AbortController().signal).then(() => assert.fail('should fail'), (failure: unknown) => failure);
  assert.ok(error instanceof ProviderError);
  assert.equal(error.provider, 'jolpica-admission');
  assert.equal(isProviderUnavailable(error), false);
  assert.doesNotMatch(error.message, /synthetic-token|max requests/);
});

test("YouTube's quota reply (403 quotaExceeded / rateLimitExceeded) is a rate limit; its other 403s are configuration", async () => {
  const youtube = (body: unknown) => failureOf((async () => Response.json(body, { status: 403 })) as typeof fetch);
  for (const reason of ['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']) {
    const error = await youtube({ error: { code: 403, errors: [{ reason }] } });
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, 'rate-limit', reason);
    assert.equal(isProviderUnavailable(error), true);
  }
  for (const body of [{ error: { code: 403, errors: [{ reason: 'forbidden' }] } }, {}, { error: 'denied' }])
    assert.equal(classifyProviderFailure(await youtube(body)), 'configuration', JSON.stringify(body));
  // A 404 is never an outage, even when an edge answered it: the path is ours.
  assert.equal(classifyProviderFailure(await failureOf(respond('<html>404</html>', 404, 'text/html'))), 'request-rejected');
  assert.equal(classifyProviderFailure(await failureOf(respond('<html>401</html>', 401, 'text/html'))), 'configuration');
});

// ---------- Independent review 2026-10-31 (docs/audit/2026-10-31/cron-review.md) ----------

async function localServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return { url: (path: string) => `http://127.0.0.1:${port}${path}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
const undiciFailure = (cause: Error) => Object.assign(new TypeError('fetch failed'), { cause });

test('review F-01 E1: our own TypeError inside a provider deadline is our bug (internal), not an outage', async () => {
  const error = await withProviderDeadline('rss', async () => { (undefined as unknown as { items: unknown[] }).items.map(String); }).then(() => assert.fail('must throw'), (failure: unknown) => failure);
  assert.ok(error instanceof TypeError, 'rethrown unchanged');
  assert.equal(classifyProviderFailure(error), 'internal');
  assert.equal(isProviderUnavailable(error), false);
  for (const bug of [new ReferenceError('x is not defined'), new RangeError('bad'), Object.assign(new Error('assertion'), { code: 'ERR_ASSERTION' }), new TypeError('fetch failed')])
    assert.equal(isProviderUnavailable(await withProviderDeadline('jolpica', async () => { throw bug; }).catch((failure: unknown) => failure)), false, bug.message);
});

test('review F-01 E2: a permanent 301/308 move (real fetch, redirect:error) is a request problem, red', async () => {
  for (const status of [301, 308]) {
    const server = await localServer((_req, res) => { res.writeHead(status, { location: 'http://127.0.0.1:1/new' }); res.end(); });
    try {
      const error = await requestJson('jolpica', server.url('/ergast/f1/current.json'), {}, { timeoutMs: 3_000 }).then(() => assert.fail('must throw'), (failure: unknown) => failure);
      assert.ok(error instanceof ProviderError);
      assert.equal(error.code, 'redirect');
      assert.equal(classifyProviderFailure(error), 'request-rejected');
    } finally { await server.close(); }
  }
});

test('review F-01: TLS/certificate failures are configuration; real network failures stay outages', async () => {
  const via = (thrown: unknown) => failureOf((async () => { throw thrown; }) as typeof fetch);
  for (const code of ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN'])
    assert.equal(classifyProviderFailure(await via(undiciFailure(Object.assign(new Error('certificate problem'), { code })))), 'configuration', code);
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])
    assert.equal(classifyProviderFailure(await via(undiciFailure(Object.assign(new Error('network'), { code })))), 'provider-unavailable', code);
  assert.equal(classifyProviderFailure(await via(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }))), 'provider-unavailable');
  assert.equal(classifyProviderFailure(await via(new DOMException('The operation was aborted.', 'AbortError'))), 'provider-unavailable');
  assert.equal(classifyProviderFailure(await via(new DOMException('signal timed out', 'TimeoutError'))), 'provider-unavailable');
  // A real refused connection through undici: a port that was just closed.
  const closed = await localServer((_req, res) => res.end());
  const port = new URL(closed.url('/')).port;
  await closed.close();
  const refused = await requestJson('jolpica', `http://127.0.0.1:${port}/x.json`, {}, { timeoutMs: 3_000 }).catch((failure: unknown) => failure);
  assert.equal(classifyProviderFailure(refused), 'provider-unavailable');
  // fetch's own blocked-port refusal ("bad port") is our configuration, not an outage.
  assert.equal(isProviderUnavailable(await requestJson('jolpica', 'http://127.0.0.1:1/x.json', {}, { timeoutMs: 3_000 }).catch((failure: unknown) => failure)), false);
});

test('review F-04 E3: a provider JSON 4xx is a request problem whatever its size or read time', async () => {
  const server = await localServer((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    if (req.url === '/big') res.end(JSON.stringify({ detail: `Bad Request: ${'x'.repeat(5_000)}` }));
    else res.write('{"detail":"Bad'); // never finishes
  });
  try {
    for (const path of ['/big', '/stalled']) {
      const error = await requestJson('jolpica', server.url(path), {}, { timeoutMs: 3_000 }).then(() => assert.fail('must throw'), (failure: unknown) => failure);
      assert.ok(error instanceof ProviderError, path);
      assert.equal(error.origin, 'provider', path);
      assert.equal(classifyProviderFailure(error), 'request-rejected', path);
    }
  } finally { await server.close(); }
});

test('review F-06: a failed response adds no body-read wait (only a capped quota peek on JSON 403)', async () => {
  const stalled = (status: number, type: string) => (async () => new Response(new ReadableStream({ start() { /* never enqueues or closes */ } }), { status, headers: { 'content-type': type } })) as typeof fetch;
  for (const [status, type, limit] of [[500, 'application/json', 50], [400, 'application/json', 50], [400, 'text/html', 50], [429, 'application/json', 50], [403, 'application/json', 400]] as const) {
    const started = performance.now();
    const error = await failureOf(stalled(status, type));
    const elapsed = performance.now() - started;
    assert.ok(error instanceof ProviderError, String(status));
    assert.ok(elapsed < limit, `HTTP ${status} ${type}: ${elapsed.toFixed(0)} ms`);
  }
});
