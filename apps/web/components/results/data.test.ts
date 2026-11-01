import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../../packages/api-client/src/transport';
import { loadSeasonSummary } from './data';

/** A two-round season with no sprint whose running totals reproduce the official table. */
function race(round: number, winner: string, second: string) {
  return {
    season: '1988', round: String(round), raceName: `Round ${round}`, date: `1988-0${round}-01`, url: '',
    Circuit: { circuitId: 'c', circuitName: 'C', url: '', Location: { lat: '0', long: '0', locality: 'X', country: 'Y' } },
    Results: [
      { position: '1', positionText: '1', points: '9', number: '1', grid: '1', laps: '1', status: 'Finished', Driver: { driverId: winner, givenName: 'A', familyName: winner, url: '', nationality: '' }, Constructor: { constructorId: 'mclaren', name: 'McLaren', url: '', nationality: '' } },
      { position: '2', positionText: '2', points: '6', number: '2', grid: '2', laps: '1', status: 'Finished', Driver: { driverId: second, givenName: 'B', familyName: second, url: '', nationality: '' }, Constructor: { constructorId: 'mclaren', name: 'McLaren', url: '', nationality: '' } },
    ],
  };
}
const results = [race(1, 'prost', 'senna'), race(2, 'senna', 'prost')];
const schedule = results.map((r) => ({ ...r, Results: undefined }));
const finals = [{ id: 'prost', points: 15 }, { id: 'senna', points: 15 }];

test('RES-3: one transient failed read is retried, so the chart and the Winners stat are not lost for the cache window', async () => {
  let calls = 0;
  const provider = {
    getSeasonResults: async () => { calls++; if (calls === 1) throw new ProviderError('jolpica', 'timeout'); return results; },
    getSchedule: async () => schedule,
    getSprint: async () => [],
  };
  const summary = await loadSeasonSummary(1988, 'drivers', finals, null, provider as never, { delayMs: 0 });
  assert.equal(calls, 2);
  assert.ok(summary.progression, 'the round-by-round chart is drawn');
  assert.equal(summary.winners, 2);
  assert.equal(summary.degraded, false);
});

test('RES-3: a read that stays down marks the summary degraded (the page then keeps that render for one minute, not five)', async () => {
  const provider = {
    getSeasonResults: async () => results,
    getSchedule: async () => { throw new ProviderError('jolpica', 'http', 503); },
    getSprint: async () => [],
  };
  const summary = await loadSeasonSummary(1988, 'drivers', finals, null, provider as never, { delayMs: 0 });
  assert.equal(summary.progression, null);
  assert.match(summary.progressionNote ?? '', /can't be shown right now/);
  assert.equal(summary.winners, 2, 'Winners comes from the results that did load');
  assert.equal(summary.degraded, true);
});

test('RES-3: a degraded summary shortens the page cache and the Winners cell never disappears', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./StandingsView.tsx', import.meta.url), 'utf8');
  assert.match(source, /summary\.degraded\)\s*await outageConnection\(\)/);
  assert.doesNotMatch(source, /summary\.winners != null \? \[/, 'the stats strip keeps its Winners column with a truthful dash');
});
