import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpica } from './client';
import { ProviderError, failOr, isFrameworkControlError, withProviderDeadline } from '../transport';

const TOTAL = 350;
function driversPage(url: URL, total = TOTAL) {
  const offset = Number(url.searchParams.get('offset'));
  const limit = Number(url.searchParams.get('limit'));
  const count = Math.max(0, Math.min(limit, total - offset));
  const Drivers = Array.from({ length: count }, (_, i) => ({ driverId: `d${offset + i}`, givenName: 'Given', familyName: `Family${offset + i}` }));
  return { MRData: { total: String(total), offset: String(offset), limit: String(limit), DriverTable: { Drivers } } };
}

test('pages after the first are fetched concurrently and merged in offset order', async () => {
  let inFlight = 0;
  let peak = 0;
  const offsets: number[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    offsets.push(Number(url.searchParams.get('offset')));
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight--;
    return Response.json(driversPage(url));
  };
  const drivers = await jolpica.getAllDrivers({ strict: true, fetchImpl });
  assert.equal(drivers.length, TOTAL);
  assert.deepEqual(drivers.map((driver) => driver.driverId), Array.from({ length: TOTAL }, (_, i) => `d${i}`));
  assert.equal(offsets[0], 0);
  assert.deepEqual([...offsets].sort((a, b) => a - b), [0, 100, 200, 300]);
  assert.equal(peak, 3);
});

test('a total that changes between pages is rejected as incomplete', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    return Response.json(driversPage(url, url.searchParams.get('offset') === '0' ? TOTAL : TOTAL + 1));
  };
  await assert.rejects(jolpica.getAllDrivers({ strict: true, fetchImpl }), (error) => error instanceof ProviderError && error.code === 'incomplete');
});

test('Next.js control-flow errors pass through provider wrappers untouched', async () => {
  const dynamic = Object.assign(new Error('Dynamic server usage'), { digest: 'DYNAMIC_SERVER_USAGE' });
  const notFound = Object.assign(new Error('not found'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  assert.equal(isFrameworkControlError(dynamic), true);
  assert.equal(isFrameworkControlError(notFound), true);
  assert.equal(isFrameworkControlError(new Error('boom')), false);
  assert.equal(isFrameworkControlError(Object.assign(new Error('x'), { digest: '12345' })), false);
  await assert.rejects(withProviderDeadline('jolpica', async () => { throw dynamic; }), (error) => error === dynamic);
  assert.throws(() => failOr('jolpica', dynamic, false, []), (error) => error === dynamic);
  // Real socket failures still become redacted provider errors / fallbacks; any other thrown
  // error is our own bug and passes through unchanged (review F-01, 2026-10-31).
  const socket = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket'), { code: 'ECONNRESET' }) });
  await assert.rejects(withProviderDeadline('jolpica', async () => { throw socket; }), (error) => error instanceof ProviderError && error.code === 'network');
  const bug = new Error('socket');
  await assert.rejects(withProviderDeadline('jolpica', async () => { throw bug; }), (error) => error === bug);
  assert.deepEqual(failOr('jolpica', new Error('socket'), false, []), []);
});
