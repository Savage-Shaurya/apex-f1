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
