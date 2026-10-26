import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { resetOpenF1LockoutMemo } from '@apex/api-client/openf1';
import { getSessionResult, HistoryUnavailable } from './openf1-history';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; resetOpenF1LockoutMemo(); });

const respond = (status: number, body: unknown) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
};

test('the live-session 401 from OpenF1 becomes a locked read', async () => {
  respond(401, { detail: 'Live F1 session in progress. Global API access (including past sessions) is restricted to authenticated users until the session ends.' });
  await assert.rejects(getSessionResult(11392), (e: unknown) => e instanceof HistoryUnavailable && e.reason === 'locked');
});

test('a 404 is an empty classification and a 500 is a status failure', async () => {
  respond(404, { detail: 'No results found.' });
  assert.deepEqual(await getSessionResult(11392), []);
  // A session with no stored copy fails honestly on a 500.
  respond(500, { detail: 'error' });
  await assert.rejects(getSessionResult(11395), (e: unknown) => e instanceof HistoryUnavailable && e.reason === 'status');
  // A session read before keeps serving its last good copy through an outage (shared client last-good).
  assert.deepEqual(await getSessionResult(11392), []);
});

test('R3-SEC-1 / R3-CODE-2: history reads use the shared client: a remembered lockout spends no request and serves nothing invented', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ detail: 'Live F1 session in progress.' }), { status: 401 }); }) as typeof fetch;
  await assert.rejects(getSessionResult(11393), (e: unknown) => e instanceof HistoryUnavailable && e.reason === 'locked');
  assert.equal(calls, 1);
  // The lockout is now remembered: the next read is refused without a request.
  await assert.rejects(getSessionResult(11394), (e: unknown) => e instanceof HistoryUnavailable && e.reason === 'locked');
  assert.equal(calls, 1);
});

test('R3-CODE-1: the live sheet and home read the same normalised coded position', async () => {
  respond(200, [{ position: 'RT', driver_number: 6, number_of_laps: 3, dnf: false, dns: false, dsq: false, duration: [null, null, null], gap_to_leader: [null, null, null], meeting_key: 1296, session_key: 11384 }]);
  const [row] = await getSessionResult(11384);
  assert.equal(row!.position, null);
  assert.equal(row!.position_code, 'RT');
});
