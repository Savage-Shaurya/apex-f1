import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpica, type FetchOpts, type JolpicaRace } from '@apex/api-client/jolpica';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { readCalendar, readConstructorIdentity, readConstructorWindow, readCurrentStandings, readDriverIdentity, readPublicSport, readSearchCorpus } from './public-sport';

const driver = { driverId: 'fixture_driver', givenName: 'Fixture', familyName: 'Driver' };
const constructor = { constructorId: 'fixture_team', name: 'Fixture Team' };
const race: JolpicaRace = { season: '2026', round: '1', raceName: 'Fixture Grand Prix', date: '2026-06-01', url: '', Circuit: { circuitId: 'fixture', circuitName: 'Fixture Circuit', url: '', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } } };

test('transport outages are unavailable while confirmed empty and zero data remain available', async () => {
  for (const provider of ['jolpica', 'openf1']) for (const code of ['network', 'timeout', 'http', 'invalid-response', 'incomplete', 'rate-limit'] as const) {
    assert.deepEqual(await readPublicSport(async () => { throw new ProviderError(provider, code); }), { state: 'unavailable', reason: code === 'rate-limit' ? 'rate-limit' : 'provider' });
  }
  assert.deepEqual(await readPublicSport(async () => []), { state: 'available', data: [] });
  assert.deepEqual(await readPublicSport(async () => ({ wins: 0 })), { state: 'available', data: { wins: 0 } });
  await assert.rejects(readPublicSport(async () => { throw new TypeError('Coding error'); }), /Coding error/);
  await assert.rejects(readPublicSport(async () => { throw new ProviderError('jolpica', 'invalid-input'); }), /invalid-input/);
});

test('identity absence, provider outage and invalid route IDs are three distinct outcomes', async () => {
  const valid = { ...jolpica, getDriver: async (_id: string, options?: FetchOpts) => { assert.equal(options?.strict, true); return driver; }, getConstructor: async () => constructor };
  assert.deepEqual(await readDriverIdentity(driver.driverId, valid), { state: 'found', raw: driver });
  assert.deepEqual(await readConstructorIdentity(constructor.constructorId, valid), { state: 'found', raw: constructor });
  const absent = { ...valid, getDriver: async () => null, getConstructor: async () => null };
  assert.deepEqual(await readDriverIdentity(driver.driverId, absent), { state: 'missing' });
  assert.deepEqual(await readConstructorIdentity(constructor.constructorId, absent), { state: 'missing' });
  const failed = { ...valid, getDriver: async () => { throw new ProviderError('jolpica', 'http', 403); }, getConstructor: async () => { throw new ProviderError('response', 'timeout'); } };
  assert.deepEqual(await readDriverIdentity(driver.driverId, failed), { state: 'unavailable', reason: 'provider' });
  assert.deepEqual(await readConstructorIdentity(constructor.constructorId, failed), { state: 'unavailable', reason: 'provider' });
  assert.deepEqual(await readDriverIdentity('../admin', { ...valid, getDriver: async () => { throw new Error('Must not request invalid slug'); } }), { state: 'missing' });
});

test('a failed current calendar never requests a guessed next season', async () => {
  const calls: Array<number | 'current'> = [];
  const provider = { getSchedule: async (season: number | 'current', options?: FetchOpts) => { calls.push(season); assert.equal(options?.strict, true); throw new ProviderError('jolpica', 'http', 429); } };
  const state = await readCalendar(provider, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(state.state, 'unavailable'); assert.equal(state.next, null); assert.deepEqual(calls, ['current']);
});

test('a confirmed published upcoming race does not request the next season (only the previous one, for the last race)', async () => {
  const calls: Array<number | 'current'> = [];
  const state = await readCalendar({ getSchedule: async (season = 'current') => { calls.push(season); return [race]; } }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(state.state, 'available'); assert.equal(state.next?.round, 1); assert.deepEqual(calls, ['current', 2025]);
  // The 2025 read returned no 2025 race, so no last race is invented.
  assert.equal(state.previous, null);
});

test('R3-TIME-2: with next at round 1 the last race is the previous season\'s final round, never null all winter', async () => {
  const final2025 = { ...race, season: '2025', round: '24', date: '2025-12-07' };
  const provider = { getSchedule: async (season: number | 'current' = 'current') => (season === 'current' ? [race] : season === 2025 ? [{ ...race, season: '2025', date: '2025-03-16' }, final2025] : []) };
  for (const now of ['2025-12-20T00:00:00Z', '2026-01-15T00:00:00Z', '2026-03-01T00:00:00Z']) {
    const state = await readCalendar(provider, Date.parse(now));
    assert.equal(state.next?.season, 2026, now); assert.equal(state.next?.round, 1, now);
    assert.equal(state.previous?.season, 2025, now); assert.equal(state.previous?.round, 24, now);
  }
  // A failed previous-season read leaves no last race rather than a guess; the calendar itself stays available.
  const failing = await readCalendar({ getSchedule: async (season: number | 'current' = 'current') => { if (season === 'current') return [race]; throw new ProviderError('jolpica', 'http', 503); } }, Date.parse('2026-01-15T00:00:00Z'));
  assert.equal(failing.state, 'available'); assert.equal(failing.previous, null);
});

test('confirmed season completion may advance only to a successfully published next-year calendar', async () => {
  const calls: Array<number | 'current'> = [];
  const old = { ...race, season: '2025', date: '2025-06-01' };
  const state = await readCalendar({ getSchedule: async (season = 'current') => { calls.push(season); return season === 'current' ? [old] : [race]; } }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(state.state, 'available'); assert.equal(state.season, 2026); assert.equal(state.previous?.season, 2025); assert.deepEqual(calls, ['current', 2026]);
  const failed = await readCalendar({ getSchedule: async season => { if (season === 'current') return [old]; throw new ProviderError('jolpica', 'network'); } }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(failed.state, 'unavailable'); assert.equal(failed.season, 2025); assert.equal(failed.next, null); assert.equal(failed.races.length, 1);
});

test('standings outage never means preseason or triggers a previous-season fallback', async () => {
  const calls: Array<number | 'current'> = [];
  const read = await readCurrentStandings(async (season, options) => { calls.push(season); assert.equal(options.strict, true); throw new ProviderError('jolpica', 'http', 429); }, Date.parse('2026-01-01T00:00:00Z'));
  assert.deepEqual(read, { state: 'unavailable', snapshot: null, previousSeasonFinal: false }); assert.deepEqual(calls, ['current']);
});

const calendarOf = (season: number | null) => ({ getSchedule: async () => season === null ? (() => { throw new ProviderError('jolpica', 'http', 503); })() : [{ season: String(season), round: '1' }] }) as never;

test('confirmed empty current standings may use a labelled previous table, with no guessed season for empty tables', async () => {
  const calls: Array<number | 'current'> = [];
  const read = await readCurrentStandings(async season => { calls.push(season); return season === 'current' ? { season: null, round: null, standings: [] } : { season: '2025', round: 24, standings: [{ points: 0 }] }; }, Date.parse('2026-01-01T00:00:00Z'), calendarOf(2026));
  assert.equal(read.state, 'available'); assert.equal(read.snapshot?.season, '2025'); assert.equal(read.previousSeasonFinal, true); assert.deepEqual(calls, ['current', 2025]);
  const empty = await readCurrentStandings(async () => ({ season: null, round: null, standings: [] }), Date.now(), calendarOf(2026));
  assert.equal(empty.state, 'available'); assert.equal(empty.snapshot?.season, null); assert.equal(empty.previousSeasonFinal, false);
});

test('the previous season comes from the Jolpica calendar, not the clock; the safe floor applies only when the calendar is unreadable', async () => {
  const asked = async (calendar: never, now: string) => {
    const calls: Array<number | 'current'> = [];
    await readCurrentStandings(async season => { calls.push(season); return season === 'current' ? { season: null, round: null, standings: [] } : { season: String(season), round: 20, standings: [{ points: 1 }] }; }, Date.parse(now), calendar);
    return calls[1];
  };
  // Calendar already on 2027 in December 2026 (clock says 2026): previous is 2026, not 2025.
  assert.equal(await asked(calendarOf(2027), '2026-12-20T00:00:00Z'), 2026);
  // Calendar still 2026 on 2 January 2027: previous is 2025 per Jolpica.
  assert.equal(await asked(calendarOf(2026), '2027-01-02T00:00:00Z'), 2025);
  // Calendar unreadable: the season before this calendar year (always finished).
  assert.equal(await asked(calendarOf(null), '2027-01-02T00:00:00Z'), 2026);
});

test('constructor history preserves confirmed empty seasons and caps concurrent provider work at three', async () => {
  let active = 0; let peak = 0;
  const years = [2026, 2025, 2024, 2023, 2022, 2021];
  const read = await readConstructorWindow(constructor.constructorId, years, { getConstructorResultsInSeason: async (_id, year, options) => {
    assert.equal(options?.strict, true); assert.ok(options?.signal); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return year === 2026 ? [] : [{ ...race, season: String(year), Results: [] }];
  } });
  assert.equal(read.state, 'available'); assert.ok(peak <= 3);
  if (read.state === 'available') { assert.deepEqual(read.data.map(entry => entry.year), years); assert.deepEqual(read.data[0]?.races, []); }
});

test('a single failed season makes the whole history unavailable rather than emitting partial totals', async () => {
  const read = await readConstructorWindow(constructor.constructorId, [2026, 2025, 2024], { getConstructorResultsInSeason: async (_id, year) => { if (year === 2025) throw new ProviderError('jolpica', 'http', 429); return []; } });
  assert.deepEqual(read, { state: 'unavailable', reason: 'rate-limit' });
});

test('history fanout has a whole-operation deadline even for an abort-ignoring dependency', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const read = readConstructorWindow(constructor.constructorId, [2026, 2025, 2024], { getConstructorResultsInSeason: async () => new Promise(() => {}) });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(20_000);
  assert.deepEqual(await read, { state: 'unavailable', reason: 'provider' });
});

function emptySearchProvider() {
  const options: FetchOpts[] = [];
  const record = (value?: FetchOpts) => { options.push(value ?? {}); };
  return { options, provider: { ...jolpica,
    getDriverStandings: async (_season?: number | 'current', options?: FetchOpts) => { record(options); return []; },
    getConstructorStandings: async (_season?: number | 'current', options?: FetchOpts) => { record(options); return []; },
    getSchedule: async (_season?: number | 'current', options?: FetchOpts) => { record(options); return []; },
    getAllDrivers: async (options?: FetchOpts) => { record(options); return []; },
    getSeasons: async (options?: FetchOpts) => { record(options); return []; },
    getAllConstructors: async (options?: FetchOpts) => { record(options); return []; },
  } };
}
test('search may establish an empty corpus only after all six strict source reads succeed', async () => {
  const fixture = emptySearchProvider();
  assert.deepEqual(await readSearchCorpus(fixture.provider), { state: 'available', data: [[], [], [], [], [], []] });
  assert.equal(fixture.options.length, 6); assert.ok(fixture.options.every(options => options.strict && options.signal));
  assert.deepEqual(await readSearchCorpus({ ...fixture.provider, getAllDrivers: async () => { throw new ProviderError('jolpica', 'invalid-response'); } }), { state: 'unavailable', reason: 'provider' });
});

test('search whole-operation deadline releases a stalled corpus without declaring no matches', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = emptySearchProvider();
  const pending = readSearchCorpus({ ...fixture.provider, getAllDrivers: async () => new Promise(() => {}) });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  t.mock.timers.tick(20_000);
  assert.deepEqual(await pending, { state: 'unavailable', reason: 'provider' });
});

test('D2-COPY-TRUTH-5: unavailable reads carry the real reason', async () => {
  const { unavailableReason } = await import('./public-sport');
  assert.equal(unavailableReason(new ProviderError('openf1', 'configuration')), 'configuration');
  assert.equal(unavailableReason(new ProviderError('jolpica', 'http', 429)), 'rate-limit');
  assert.equal(unavailableReason(new ProviderError('jolpica', 'http', 503)), 'provider');
  const { OpenF1LiveSessionLockout } = await import('@apex/api-client/openf1');
  assert.equal(unavailableReason(new OpenF1LiveSessionLockout()), 'live-session');
});

test('wave-1 leftover: an empty current table reads the season before the one Jolpica declares, not the clock', async () => {
  const seen: Array<number | 'current'> = [];
  const read = async (season: number | 'current') => {
    seen.push(season);
    return season === 'current' ? { season: null, round: null, standings: [], tableSeason: 2031 } : { season: String(season), round: 24, standings: [{}] };
  };
  const result = await readCurrentStandings(read, Date.parse('2026-01-05T00:00:00Z'));
  assert.deepEqual(seen, ['current', 2030]);
  assert.equal(result.previousSeasonFinal, true);
});

test('during next build a transient identity failure is retried (bounded) instead of failing the prerender; at runtime one try', async () => {
  let calls = 0;
  const flaky = { getDriver: async () => { calls++; if (calls < 3) throw new ProviderError('jolpica', 'http', 503); return { driverId: 'lawson' }; }, getConstructor: async () => null } as never;
  const found = await readDriverIdentity('lawson', flaky, { attempts: 3, sleep: async () => {} });
  assert.equal(found.state, 'found');
  assert.equal(calls, 3);
  calls = 0;
  const once = await readDriverIdentity('lawson', flaky, { attempts: 1 });
  assert.equal(once.state, 'unavailable');
  assert.equal(calls, 1);
});
