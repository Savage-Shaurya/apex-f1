import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOpenF1Diagnostic } from './openf1-diagnostic';
import type { OpenF1Session, FetchOpts } from '@apex/api-client/openf1';

const now = Date.parse('2026-09-30T12:00:00Z');
const session = { session_key: 123, date_start: '2026-09-30T11:00:00Z', date_end: '2026-09-30T13:00:00Z' } as OpenF1Session;
test('diagnostic makes one bounded sample with five paced requests and strict failures', async () => {
  const requests: FetchOpts[] = [], waits: number[] = [];
  const read = async (_key: number, opts: FetchOpts = {}) => { requests.push(opts); return []; };
  const summary = await runOpenF1Diagnostic({ now: () => now, wait: async (ms) => { waits.push(ms); }, source: {
    getLatestSession: async (opts = {}) => { requests.push(opts); return session; }, getIntervals: read, getPositions: read, getRaceControl: read, getWeather: read,
  } });
  assert.equal(summary.status, 'sampled');
  assert.equal(requests.length, 5);
  assert.deepEqual(waits, [2500, 2500, 2500, 2500]);
  for (const request of requests) { assert.equal(request.strict, true); assert.equal(request.timeoutMs, 5000); assert.equal(request.maxBytes, 250000); }
  assert.equal(requests[1]!.dateGte, '2026-09-30T11:58:00.000Z');
  assert.equal(requests[1]!.dateLte, '2026-09-30T12:00:00.000Z');
});
test('no session stops after discovery and makes no channel requests', async () => {
  const forbidden = async () => { throw new Error('Channel call forbidden'); };
  const summary = await runOpenF1Diagnostic({ source: { getLatestSession: async () => null, getIntervals: forbidden, getPositions: forbidden, getRaceControl: forbidden, getWeather: forbidden } });
  assert.equal(summary.status, 'no-session');
});
test('provider failure rejects the diagnostic instead of logging an empty healthy snapshot', async () => {
  const fail = async () => { throw new Error('Synthetic provider failure'); };
  await assert.rejects(runOpenF1Diagnostic({ source: { getLatestSession: fail, getIntervals: fail, getPositions: fail, getRaceControl: fail, getWeather: fail } }), /Synthetic provider failure/);
});
test('aborted diagnostic performs no provider calls', async () => {
  const controller = new AbortController(); controller.abort();
  const fail = async () => { throw new Error('Provider call forbidden'); };
  await assert.rejects(runOpenF1Diagnostic({ signal: controller.signal, source: { getLatestSession: fail, getIntervals: fail, getPositions: fail, getRaceControl: fail, getWeather: fail } }), /abort/i);
});
