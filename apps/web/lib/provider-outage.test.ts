import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { ProviderOutageError, orOutage, providerOutage } from './provider-outage';

test('provider failures become a typed outage (route error boundary, HTTP 500); other errors pass through', async () => {
  assert.throws(() => providerOutage('driver profile'), (error) => error instanceof ProviderOutageError && error.area === 'driver profile');
  await assert.rejects(orOutage('race page', async () => { throw new ProviderError('jolpica', 'http', 503); }), ProviderOutageError);
  await assert.rejects(orOutage('race page', async () => { throw new ProviderError('jolpica', 'rate-limit'); }), ProviderOutageError);
  const bug = new TypeError('programming error');
  await assert.rejects(orOutage('race page', async () => { throw bug; }), (error) => error === bug);
  assert.equal(await orOutage('race page', async () => 42), 42);
});

test('provider outages carry a stable digest that client error boundaries recognise (first uncached visit shows the unavailable state)', async () => {
  const { isProviderOutageDigest, providerOutageDigest } = await import('./provider-outage-digest');
  const error = new ProviderOutageError('race calendar');
  assert.equal(error.digest, 'APEX_PROVIDER_OUTAGE:race-calendar');
  assert.ok(isProviderOutageDigest(error.digest));
  assert.equal(isProviderOutageDigest('2841094932'), false);
  assert.equal(isProviderOutageDigest(undefined), false);
  assert.equal(providerOutageDigest('<script>'), 'APEX_PROVIDER_OUTAGE:script');
});

test('an outage never calls connection() inside a runtime ISR render (that would 500 instead of the unavailable state)', async () => {
  const { isRuntimeIsrRender } = await import('./outage-connection');
  assert.equal(isRuntimeIsrRender('prerender-legacy', undefined), true);
  assert.equal(isRuntimeIsrRender('prerender-legacy', 'phase-production-build'), false);
  assert.equal(isRuntimeIsrRender('request', undefined), false);
  assert.equal(isRuntimeIsrRender(undefined, undefined), false);
});
