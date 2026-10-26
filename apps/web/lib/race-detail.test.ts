import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { jolpica, JolpicaRace } from '@apex/api-client/jolpica';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { loadRaceCalendar, loadRaceResults, raceDetailMetadata } from './race-detail';
import { ProviderOutageError } from './provider-outage';

type Provider = Pick<typeof jolpica, 'getSchedule' | 'getRaceResults'>;
const weekend = (round: number): JolpicaRace => ({
  season: '2020', round: String(round), raceName: round === 4 ? 'British Grand Prix' : '70th Anniversary Grand Prix',
  date: round === 4 ? '2020-08-02' : '2020-08-09', time: '13:10:00Z', url: '',
  Circuit: { circuitId: 'silverstone', circuitName: 'Silverstone Circuit', url: '', Location: { lat: '52.0786', long: '-1.0169', locality: 'Silverstone', country: 'UK' } },
});
const calendar = [weekend(4), weekend(5)];
const provider = (overrides: Partial<Provider> = {}): Provider => ({ getSchedule: async () => calendar, getRaceResults: async () => null, ...overrides });

test('calendar 429 and other provider failures stay unavailable with neutral metadata and no classification call', async () => {
  for (const code of ['http', 'network', 'timeout', 'rate-limit', 'invalid-response', 'incomplete', 'configuration'] as const) {
    let resultsCalls = 0;
    const fixture = provider({
      getSchedule: async (_season, opts) => { assert.equal(opts?.strict, true); throw new ProviderError('jolpica', code, code === 'http' ? 429 : undefined); },
      getRaceResults: async () => { resultsCalls++; return null; },
    });
    const state = await loadRaceCalendar(2020, 'silverstone-round-4', fixture);
    assert.deepEqual(state, { state: 'unavailable' });
    // An outage is a 5xx (error boundary), never a 200 noindex page.
    assert.throws(() => raceDetailMetadata(state), ProviderOutageError);
    assert.equal(resultsCalls, 0);
  }
});
test('invalid route coordinates never request data and confirmed absent races remain missing', async () => {
  let calls = 0;
  const fixture = provider({ getSchedule: async () => { calls++; return calendar; } });
  for (const [season, key] of [[1949, 'silverstone'], [2020.5, 'silverstone'], [2020, '../silverstone'], [2020, '']] as const) {
    assert.deepEqual(await loadRaceCalendar(season, key, fixture), { state: 'missing' });
  }
  assert.equal(calls, 0);
  assert.deepEqual(await loadRaceCalendar(2020, 'missing-round-8', fixture), { state: 'missing' });
  assert.deepEqual(await loadRaceCalendar(2020, 'silverstone', provider({ getSchedule: async () => [] })), { state: 'missing' });
  assert.equal(raceDetailMetadata({ state: 'missing' }).title, 'Race not found');
});
test('a calendar from a different season cannot establish a missing or guessed race', async () => {
  const fixture = provider({ getSchedule: async () => calendar.map((race) => ({ ...race, season: '2021' })) });
  assert.deepEqual(await loadRaceCalendar(2020, 'silverstone-round-4', fixture), { state: 'unavailable' });
});
test('repeated venue metadata identifies each round and starts no results work', async () => {
  let resultsCalls = 0;
  const fixture = provider({ getRaceResults: async () => { resultsCalls++; return null; } });
  for (const round of [4, 5]) {
    const state = await loadRaceCalendar(2020, `silverstone-round-${round}`, fixture);
    assert.equal(state.state, 'found');
    if (state.state !== 'found') throw new Error('Missing fixture race.');
    assert.equal(state.race.round, round);
    assert.equal(raceDetailMetadata(state).alternates?.canonical, `/schedule/2020/silverstone-round-${round}`);
  }
  assert.equal(resultsCalls, 0);
  const legacy = await loadRaceCalendar(2020, 'silverstone', fixture);
  assert.equal(legacy.state === 'found' ? legacy.race.round : null, 4);
});
test('a classification outage retains the verified calendar and named metadata without inventing results', async () => {
  const state = await loadRaceCalendar(2020, 'silverstone-round-5', provider());
  if (state.state !== 'found') throw new Error('Missing fixture race.');
  const metadataBefore = raceDetailMetadata(state);
  const results = await loadRaceResults(state.race, provider({ getRaceResults: async (season, round, opts) => {
    assert.equal(season, 2020); assert.equal(round, 5); assert.equal(opts?.strict, true);
    throw new ProviderError('jolpica', 'http', 429);
  } }));
  assert.deepEqual(results, { state: 'unavailable' });
  assert.equal(Object.hasOwn(results, 'results'), false);
  assert.deepEqual(raceDetailMetadata(state), metadataBefore);
  assert.equal(metadataBefore.title, '70th Anniversary Grand Prix 2020');
});
test('successful null and empty classification responses remain confirmed empty rather than outages', async () => {
  const state = await loadRaceCalendar(2020, 'silverstone-round-4', provider());
  if (state.state !== 'found') throw new Error('Missing fixture race.');
  assert.deepEqual(await loadRaceResults(state.race, provider()), { state: 'available', results: [] });
  const race = { ...weekend(4), Results: [] };
  assert.deepEqual(await loadRaceResults(state.race, provider({ getRaceResults: async () => ({ race, results: [] }) })), { state: 'available', results: [] });
});
test('bounded body-reader failures remain unavailable for calendar and classification', async () => {
  const state = await loadRaceCalendar(2020, 'silverstone-round-4', provider());
  if (state.state !== 'found') throw new Error('Missing fixture race.');
  for (const code of ['invalid-response', 'timeout'] as const) {
    const error = new ProviderError('response', code);
    assert.deepEqual(await loadRaceCalendar(2020, 'silverstone-round-4', provider({ getSchedule: async () => { throw error; } })), { state: 'unavailable' });
    assert.deepEqual(await loadRaceResults(state.race, provider({ getRaceResults: async () => { throw error; } })), { state: 'unavailable' });
  }
});

test('a successful classification retains provider driver, constructor and result fields', async () => {
  const state = await loadRaceCalendar(2020, 'silverstone-round-4', provider());
  if (state.state !== 'found') throw new Error('Missing fixture race.');
  const entry = {
    number: '44', position: '1', positionText: '1', points: '25', grid: '1', laps: '52', status: 'Finished',
    Driver: { driverId: 'hamilton', givenName: 'Lewis', familyName: 'Hamilton', nationality: 'British' },
    Constructor: { constructorId: 'mercedes', name: 'Mercedes', nationality: 'German' },
    Time: { millis: '5281025', time: '1:28:01.025' },
  };
  const results = await loadRaceResults(state.race, provider({ getRaceResults: async () => ({ race: { ...weekend(4), Results: [entry] }, results: [entry] }) }));
  assert.equal(results.state, 'available');
  if (results.state !== 'available') throw new Error('Unavailable fixture classification.');
  assert.equal(results.results.length, 1);
  assert.equal(results.results[0]?.driver.fullName, 'Lewis Hamilton');
  assert.equal(results.results[0]?.constructor?.slug, 'mercedes');
  assert.equal(results.results[0]?.position, 1);
  assert.equal(results.results[0]?.points, 25);
  assert.equal(results.results[0]?.time, '1:28:01.025');
});

test('unexpected provider and mapping errors escape instead of becoming missing or unavailable', async () => {
  const defect = new Error('Synthetic programming defect.');
  await assert.rejects(loadRaceCalendar(2020, 'silverstone', provider({ getSchedule: async () => { throw defect; } })), (error) => error === defect);
  const state = await loadRaceCalendar(2020, 'silverstone', provider());
  if (state.state !== 'found') throw new Error('Missing fixture race.');
  await assert.rejects(loadRaceResults(state.race, provider({ getRaceResults: async () => { throw defect; } })), (error) => error === defect);
  const unrelated = new ProviderError('other-provider', 'http', 429);
  await assert.rejects(loadRaceCalendar(2020, 'silverstone', provider({ getSchedule: async () => { throw unrelated; } })), (error) => error === unrelated);
  const invalidInput = new ProviderError('jolpica', 'invalid-input');
  await assert.rejects(loadRaceCalendar(2020, 'silverstone', provider({ getSchedule: async () => { throw invalidInput; } })), (error) => error === invalidInput);
  await assert.rejects(loadRaceCalendar(2020, 'silverstone', provider({ getSchedule: async () => [{ ...weekend(4), round: '0' }] })), /Invalid race route identity/);
});

test('during a calendar outage an unknown circuit key is missing (404), a known one unavailable', async () => {
  const outage = provider({ getSchedule: async () => { throw new ProviderError('jolpica', 'configuration'); } });
  assert.deepEqual(await loadRaceCalendar(2026, 'zzz', outage), { state: 'missing' });
  assert.deepEqual(await loadRaceCalendar(2026, 'americas-round-99', outage), { state: 'missing' });
  assert.deepEqual(await loadRaceCalendar(2026, 'americas-round-18', outage), { state: 'unavailable' });
  assert.deepEqual(await loadRaceCalendar(2026, 'monaco', outage), { state: 'unavailable' });
});
