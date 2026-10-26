import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpica } from './client';
import { isRankedStanding, mapConstructorStanding, mapDriverStanding, mapResult, standingPositionLabel } from './mappers';
import { JolpicaRequestControl } from './request-control';
import { ProviderError } from '../transport';

const driver = { driverId: 'fixture_driver', givenName: 'Fixture', familyName: 'Driver' };
const constructor = { constructorId: 'fixture_team', name: 'Fixture Team' };
const result = { number: '1', position: '1', positionText: '1', points: '25', Driver: driver, Constructor: constructor };
const race = { season: '2024', round: '1', raceName: 'Fixture Grand Prix', date: '2024-03-01', Circuit: { circuitId: 'fixture', circuitName: 'Fixture Circuit', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } }, Results: [result] };
const driverStanding = { position: '1', positionText: '1', points: '25', wins: '1', Driver: driver, Constructors: [constructor] };
const constructorStanding = { position: '1', positionText: '1', points: '25', wins: '1', Constructor: constructor };
function envelope(table: Record<string, unknown>, total = 1, offset = 0) { return { MRData: { series: 'f1', limit: '100', offset: String(offset), total: String(total), ...table } }; }
function response(table: Record<string, unknown>, total = 1) { return async () => Response.json(envelope(table, total)); }
function strict(fetchImpl: typeof fetch) { return { strict: true, fetchImpl, deadlineMs: 1_000, timeoutMs: 1_000 } as const; }
function invalid(error: unknown) { return error instanceof ProviderError && (error.code === 'invalid-response' || error.code === 'incomplete'); }

test('strict identity reads reject foreign driver and constructor IDs rather than relabel them', async () => {
  await assert.rejects(jolpica.getDriver(driver.driverId, strict(response({ DriverTable: { Drivers: [{ ...driver, driverId: 'another_driver' }] } }))), invalid);
  await assert.rejects(jolpica.getConstructor(constructor.constructorId, strict(response({ ConstructorTable: { Constructors: [{ ...constructor, constructorId: 'another_team' }] } }))), invalid);
  await assert.rejects(jolpica.getDriver(driver.driverId, strict(response({ DriverTable: { driverId: 'another_driver', Drivers: [] } }, 0))), invalid);
});

test('a confirmed absent identity remains null while duplicate identities are rejected', async () => {
  assert.equal(await jolpica.getDriver(driver.driverId, strict(response({ DriverTable: { Drivers: [] } }, 0))), null);
  assert.equal(await jolpica.getConstructor(constructor.constructorId, strict(response({ ConstructorTable: { Constructors: [] } }, 0))), null);
  await assert.rejects(jolpica.getDriver(driver.driverId, strict(response({ DriverTable: { Drivers: [driver, driver] } }, 2))), invalid);
});

test('season-specific standings reject foreign seasons in row and table metadata', async () => {
  await assert.rejects(jolpica.getDriverStandings(2024, strict(response({ StandingsTable: { season: '2024', StandingsLists: [{ season: '2023', round: '1', DriverStandings: [driverStanding] }] } }))), invalid);
  await assert.rejects(jolpica.getConstructorStandings(2024, strict(response({ StandingsTable: { season: '2023', StandingsLists: [{ season: '2024', round: '1', ConstructorStandings: [constructorStanding] }] } }))), invalid);
});

test('standings require finite position and an explicit driver constructor array before mapping', async () => {
  const { position: _position, ...missingPosition } = driverStanding;
  const { Constructors: _constructors, ...missingConstructors } = driverStanding;
  for (const row of [missingPosition, missingConstructors, { ...driverStanding, position: 'NaN' }, { ...driverStanding, position: '1.5' }]) {
    await assert.rejects(jolpica.getDriverStandings(2024, strict(response({ StandingsTable: { season: '2024', StandingsLists: [{ season: '2024', round: '1', DriverStandings: [row] }] } }))), invalid);
  }
  const valid = await jolpica.getDriverStandings(2024, strict(response({ StandingsTable: { season: '2024', StandingsLists: [{ season: '2024', round: '1', DriverStandings: [{ ...driverStanding, points: '0', wins: '0' }] }] } })));
  assert.deepEqual([mapDriverStanding(valid[0]!).position, mapDriverStanding(valid[0]!).points], [1, 0]);
});

const otherDriver = { driverId: 'other_driver', givenName: 'Other', familyName: 'Driver' };
const thirdDriver = { driverId: 'third_driver', givenName: 'Third', familyName: 'Driver' };
function driverTable(rows: unknown[]) { return response({ StandingsTable: { season: '1988', StandingsLists: [{ season: '1988', round: '16', DriverStandings: rows }] } }, rows.length); }

test('historical standings keep unranked and excluded rows (no position) instead of rejecting the table', async () => {
  const { position: _p, ...unranked } = { ...driverStanding, Driver: otherDriver, positionText: '-', points: '0', wins: '0' };
  const { position: _q, ...excluded } = { ...driverStanding, Driver: thirdDriver, positionText: 'D', points: '78', wins: '5' };
  const rows = await jolpica.getDriverStandings(1988, strict(driverTable([driverStanding, excluded, unranked])));
  const mapped = rows.map(mapDriverStanding);
  assert.deepEqual(mapped.map(row => [row.driver.slug, row.position, row.positionText]), [['fixture_driver', 1, '1'], ['third_driver', null, 'D'], ['other_driver', null, '-']]);
  assert.deepEqual(mapped.map(standingPositionLabel), ['1', 'D', '–']);
  assert.deepEqual(mapped.filter(isRankedStanding).map(row => row.position), [1]);
  const { position: _r, ...unrankedTeam } = { ...constructorStanding, Constructor: { constructorId: 'other_team', name: 'Other Team' }, positionText: '-' };
  const teams = await jolpica.getConstructorStandings(1988, strict(response({ StandingsTable: { season: '1988', StandingsLists: [{ season: '1988', round: '16', ConstructorStandings: [constructorStanding, unrankedTeam] }] } }, 2)));
  assert.deepEqual(teams.map(mapConstructorStanding).map(row => row.position), [1, null]);
});

test('standings reject an unranked row that claims a numeric rank, a ranked row after unranked ones, or a rank/text mismatch', async () => {
  const { position: _p, ...numericText } = { ...driverStanding, Driver: otherDriver, positionText: '2' };
  const { position: _q, ...unranked } = { ...driverStanding, Driver: otherDriver, positionText: '-' };
  for (const rows of [
    [driverStanding, numericText],
    [unranked, driverStanding],
    [{ ...driverStanding, positionText: '2' }],
    [{ ...driverStanding, position: '0', positionText: '0' }],
    [{ ...driverStanding, position: '2', positionText: '2' }, { ...driverStanding, Driver: otherDriver }],
  ]) await assert.rejects(jolpica.getDriverStandings(1988, strict(driverTable(rows))), invalid);
});

test('driver and team seasonal results must match both the requested season and leaf participant', async () => {
  for (const bad of [{ ...race, season: '2023' }, { ...race, Results: [{ ...result, Driver: { ...driver, driverId: 'another_driver' } }] }]) {
    await assert.rejects(jolpica.getDriverResultsInSeason(driver.driverId, 2024, strict(response({ RaceTable: { season: '2024', Races: [bad] } }))), invalid);
  }
  for (const bad of [{ ...race, season: '2023' }, { ...race, Results: [{ ...result, Constructor: { ...constructor, constructorId: 'another_team' } }] }, { ...race, Results: [{ ...result, Constructor: undefined }] }]) {
    await assert.rejects(jolpica.getConstructorResultsInSeason(constructor.constructorId, 2024, strict(response({ RaceTable: { season: '2024', Races: [bad] } }))), invalid);
  }
});

test('a wrong driver on a later paginated career page rejects the complete collection', async () => {
  const seen: number[] = [];
  const fixture: typeof fetch = async url => {
    const offset = Number(new URL(String(url)).searchParams.get('offset')); seen.push(offset);
    const rows = offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ ...race, round: String(i + 1) })) : [{ ...race, round: '101', Results: [{ ...result, Driver: { ...driver, driverId: 'another_driver' } }] }];
    return Response.json(envelope({ RaceTable: { driverId: driver.driverId, Races: rows } }, 101, offset));
  };
  await assert.rejects(jolpica.getDriverResults(driver.driverId, strict(fixture)), invalid);
  assert.deepEqual(seen, [0, 100]);
});

test('a shared drive (one driver, two cars in one race) is accepted, while a repeated classification row is rejected', async () => {
  // Fangio, 1956 Argentine GP: retired his own car (order position 15, "R") and won in Musso's (shared, 4 points).
  const shared = { ...race, season: '1956', round: '1', date: '1956-01-22', Results: [{ ...result, number: '34', position: '1', positionText: '1', points: '4' }, { ...result, number: '30', position: '15', positionText: 'R', points: '0' }] };
  const read = await jolpica.getDriverResults(driver.driverId, strict(response({ RaceTable: { driverId: driver.driverId, Races: [shared] } }, 2)));
  assert.equal(read[0]!.Results.length, 2);
  const repeated = { ...shared, Results: [shared.Results[0]!, shared.Results[0]!] };
  await assert.rejects(jolpica.getDriverResults(driver.driverId, strict(response({ RaceTable: { driverId: driver.driverId, Races: [repeated] } }, 2))), invalid);
});

test('a withdrawn entry without a car number keeps the race readable (1961 French GP, Bordeu)', async () => {
  const { number: _number, ...noNumber } = result;
  const bordeu = { ...noNumber, Driver: { ...driver, driverId: 'bordeu' }, position: '28', positionText: 'W', points: '0' };
  const french = { ...race, season: '1961', round: '4', date: '1961-07-02', Results: [result, bordeu] };
  const read = await jolpica.getRaceResults(1961, 4, strict(response({ RaceTable: { season: '1961', round: '4', Races: [french] } }, 2)));
  assert.equal(read?.results.length, 2);
  // Jolpica actually serialises the missing number as the string "None".
  const live = await jolpica.getRaceResults(1961, 4, strict(response({ RaceTable: { season: '1961', round: '4', Races: [{ ...french, Results: [result, { ...bordeu, number: 'None' }] }] } }, 2)));
  assert.equal(live?.results[1]?.number, undefined);
  await assert.rejects(jolpica.getRaceResults(1961, 4, strict(response({ RaceTable: { season: '1961', round: '4', Races: [{ ...french, Results: [{ ...result, number: 'x' }] }] } }))), invalid);
});

test('winner collections reject non-winners, and optional fastest-lap fields cannot crash mapping', async () => {
  await assert.rejects(jolpica.getSeasonWinners(2024, strict(response({ RaceTable: { season: '2024', Races: [{ ...race, Results: [{ ...result, position: '2' }] }] } }))), invalid);
  await assert.rejects(jolpica.getDriverResults(driver.driverId, strict(response({ RaceTable: { Races: [{ ...race, Results: [{ ...result, FastestLap: { rank: '1', lap: '1' } }] }] } }))), invalid);
  const valid = await jolpica.getDriverResults(driver.driverId, strict(response({ RaceTable: { Races: [{ ...race, Results: [{ ...result, FastestLap: { rank: '1', lap: '1', Time: { time: '1:20.000' } } }] }] } })));
  assert.equal(mapResult(valid[0]!.Results[0]!).fastestLap?.time, '1:20.000');
});

test('calendars reject foreign seasons, duplicate rounds and impossible session dates', async () => {
  for (const rows of [[{ ...race, season: '2023' }], [race, race], [{ ...race, Qualifying: { date: '2024-02-30' } }], [{ ...race, time: '27:00:00Z' }]]) {
    await assert.rejects(jolpica.getSchedule(2024, strict(response({ RaceTable: { season: '2024', Races: rows } }, rows.length))), invalid);
  }
  const ordered = await jolpica.getSchedule(2024, strict(response({ RaceTable: { season: '2024', Races: [{ ...race, round: '2' }, race] } }, 2)));
  assert.deepEqual(ordered.map(row => row.round), ['1', '2']);
});

test('historical directories reject duplicate or invalid route IDs instead of creating broken links', async () => {
  await assert.rejects(jolpica.getAllDrivers(strict(response({ DriverTable: { Drivers: [driver, driver] } }, 2))), invalid);
  await assert.rejects(jolpica.getAllConstructors(strict(response({ ConstructorTable: { Constructors: [{ ...constructor, constructorId: '../admin' }] } }))), invalid);
  await assert.rejects(jolpica.getDrivers(2024, strict(response({ DriverTable: { season: '2023', Drivers: [driver] } }))), invalid);
  await assert.rejects(jolpica.getConstructors(2024, strict(response({ ConstructorTable: { season: '2023', Constructors: [constructor] } }))), invalid);
});

test('successful empty collections remain empty and a provider 429 is a distinct single failed attempt', async () => {
  assert.deepEqual(await jolpica.getDriverResults(driver.driverId, strict(response({ RaceTable: { Races: [] } }, 0))), []);
  assert.deepEqual(await jolpica.getSchedule(2024, strict(response({ RaceTable: { season: '2024', Races: [] } }, 0))), []);
  assert.deepEqual(await jolpica.getDriverStandingsSnapshot(2024, strict(response({ StandingsTable: { season: '2024', StandingsLists: [] } }, 0))), { season: null, round: null, standings: [], tableSeason: 2024 });
  let calls = 0;
  await assert.rejects(jolpica.getDriverResults(driver.driverId, strict(async () => { calls++; return new Response('private upstream body', { status: 429 }); })), error => error instanceof ProviderError && error.status === 429 && !error.message.includes('private'));
  assert.equal(calls, 1);
});

test('a shorter caller TTL cannot reuse an older entry retained for a longer caller', async () => {
  let clock = 0; let reads = 0;
  const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
  const read = (ttl: number) => control.readThrough('fixture', ttl, { timeoutMs: 1000 }, async () => ({ revision: ++reads }));
  assert.deepEqual(await read(3600), { revision: 1 });
  clock = 599_000; assert.deepEqual(await read(600), { revision: 1 });
  clock = 601_000; assert.deepEqual(await read(600), { revision: 2 });
  assert.equal(reads, 2);
});

test('fresh ingestion cannot join an older in-flight public render and remains paced', async () => {
  let clock = 0; let release!: (value: { revision: number }) => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const starts: number[] = [];
  const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
  const first = control.readThrough('fixture', 3600, { timeoutMs: 1000 }, async () => { starts.push(clock); began(); return new Promise<{ revision: number }>(resolve => { release = resolve; }); });
  await started;
  const fresh = control.readThrough('fixture', 0, { timeoutMs: 1000 }, async () => { starts.push(clock); return { revision: 2 }; });
  release({ revision: 1 });
  assert.deepEqual(await first, { revision: 1 }); assert.deepEqual(await fresh, { revision: 2 });
  assert.equal(starts.length, 2); assert.ok(starts[1]! - starts[0]! >= 260);
});

test('cached objects remain isolated from consumer mutations', async () => {
  const control = new JolpicaRequestControl();
  const value = await control.readThrough('fixture', 3600, {}, async () => ({ names: ['Fixture'] }));
  value.names.push('Changed');
  assert.deepEqual(await control.readThrough('fixture', 3600, {}, async () => { throw new Error('Unexpected source read'); }), { names: ['Fixture'] });
});

test('fresh and zero-TTL cancellation abort the physical operation without remembering a late result', async () => {
  for (const options of [{ ttl: 0, fresh: false }, { ttl: 3600, fresh: true }]) {
    let clock = 0;
    const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
    let began!: () => void;
    let release!: (value: { revision: number }) => void;
    let providerSignal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { began = resolve; });
    const caller = new AbortController();
    const pending = control.readThrough('cancelled_fresh', options.ttl, { fresh: options.fresh, signal: caller.signal, timeoutMs: 1000 }, async signal => {
      providerSignal = signal;
      began();
      return new Promise<{ revision: number }>(resolve => { release = resolve; });
    });
    await started;
    const rejected = assert.rejects(pending, error => error instanceof ProviderError && error.code === 'timeout');
    caller.abort();
    await rejected;
    assert.equal(providerSignal?.aborted, true);
    release({ revision: 1 });
    await new Promise(resolve => setImmediate(resolve));
    let calls = 0;
    assert.deepEqual(await control.readThrough('cancelled_fresh', 3600, { timeoutMs: 1000 }, async () => { calls++; return { revision: 2 }; }), { revision: 2 });
    assert.equal(calls, 1);
  }
});

test('a canceled fresh observation waiting behind a shared read never starts transport', async () => {
  let clock = 0;
  const control = new JolpicaRequestControl({ now: () => clock, sleep: async delay => { clock += delay; } });
  let began!: () => void;
  let release!: (value: string) => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const first = control.readThrough('held_shared', 3600, { timeoutMs: 1000 }, async () => { began(); return new Promise<string>(resolve => { release = resolve; }); });
  await started;
  const caller = new AbortController();
  let freshStarts = 0;
  const fresh = control.readThrough('queued_fresh', 0, { signal: caller.signal, timeoutMs: 1000 }, async () => { freshStarts++; return 'must not start'; });
  const rejected = assert.rejects(fresh, error => error instanceof ProviderError && error.code === 'timeout');
  caller.abort();
  await rejected;
  release('confirmed');
  assert.equal(await first, 'confirmed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(freshStarts, 0);
});

test('one canceled positive-TTL caller cannot abort another caller sharing the same physical read', async () => {
  const control = new JolpicaRequestControl();
  let began!: () => void;
  let release!: (value: { revision: number }) => void;
  let providerSignal: AbortSignal | undefined;
  const started = new Promise<void>(resolve => { began = resolve; });
  const caller = new AbortController();
  let starts = 0;
  const first = control.readThrough('shared_source', 3600, { signal: caller.signal, timeoutMs: 1000 }, async signal => {
    starts++;
    providerSignal = signal;
    began();
    return new Promise<{ revision: number }>(resolve => { release = resolve; });
  });
  await started;
  const second = control.readThrough('shared_source', 3600, { timeoutMs: 1000 }, async () => { starts++; throw new Error('Unexpected duplicate request'); });
  const rejected = assert.rejects(first, error => error instanceof ProviderError && error.code === 'timeout');
  caller.abort();
  await rejected;
  assert.equal(providerSignal?.aborted, false);
  release({ revision: 1 });
  assert.deepEqual(await second, { revision: 1 });
  assert.deepEqual(await control.readThrough('shared_source', 3600, {}, async () => { throw new Error('Unexpected cache miss'); }), { revision: 1 });
  assert.equal(starts, 1);
});

test('malformed HTTP200 data cannot poison healthy recovery or bypass the validated process cache', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.cache, 'no-store');
    assert.equal((init as RequestInit & { next?: unknown }).next, undefined);
    assert.ok(init?.signal);
    calls++;
    return Response.json(envelope({ DriverTable: { season: '1953', Drivers: calls === 1 ? [{}] : [driver] } }));
  });
  await assert.rejects(jolpica.getDrivers(1953, { strict: true, revalidate: 86_400 }), invalid);
  assert.deepEqual(await jolpica.getDrivers(1953, { strict: true, revalidate: 86_400 }), [driver]);
  assert.deepEqual(await jolpica.getDrivers(1953, { strict: true, revalidate: 86_400 }), [driver]);
  assert.equal(calls, 2);
});

test('championship reads use supported season-specific position-one endpoints and preserve final season/round', async () => {
  const requested: string[] = [];
  const fetchImpl: typeof fetch = async url => {
    const path = new URL(String(url)).pathname; requested.push(path);
    const winnerRows = path.includes('driverStandings') ? { DriverStandings: [driverStanding] } : { ConstructorStandings: [constructorStanding] };
    return Response.json(envelope({ StandingsTable: { season: '2025', round: '24', StandingsLists: [{ season: '2025', round: '24', ...winnerRows }] } }));
  };
  assert.equal((await jolpica.getDriverChampionSnapshot(2025, strict(fetchImpl))).round, 24);
  assert.equal((await jolpica.getConstructorChampionSnapshot(2025, strict(fetchImpl))).season, '2025');
  assert.deepEqual(requested, ['/ergast/f1/2025/driverStandings/1.json', '/ergast/f1/2025/constructorStandings/1.json']);
});

test('filtered championship snapshots reject wrong seasons, duplicate winners, round zero and incomplete metadata', async () => {
  for (const method of ['getDriverChampionSnapshot', 'getConstructorChampionSnapshot'] as const) {
    const field = method === 'getDriverChampionSnapshot' ? 'DriverStandings' : 'ConstructorStandings';
    const winner = field === 'DriverStandings' ? driverStanding : constructorStanding;
    for (const [season, round, selected, total] of [['2024', '1', [winner], 1], ['2025', '0', [winner], 1], ['2025', '1', [winner, winner], 2], ['2025', '1', [], 1]] as const) {
      await assert.rejects(jolpica[method](2025, strict(response({ StandingsTable: { season, StandingsLists: [{ season, round, [field]: selected }] } }, total))), invalid);
    }
    assert.deepEqual((await jolpica[method](2025, strict(response({ StandingsTable: { season: '2025', StandingsLists: [] } }, 0)))).standings, []);
  }
});

test('actual process championship cache rejects a false winner before remembering it and immediately recovers', async t => {
  const calls = new Map<string, number>();
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname; const count = (calls.get(path) ?? 0) + 1; calls.set(path, count);
    const field = path.includes('driverStandings') ? 'DriverStandings' : 'ConstructorStandings';
    const winner = field === 'DriverStandings' ? driverStanding : constructorStanding;
    return Response.json(envelope({ StandingsTable: { season: '1954', StandingsLists: [{ season: '1954', round: '9', [field]: [{ ...winner, position: count === 1 ? '2' : '1' }] }] } }));
  });
  for (const method of ['getDriverChampionSnapshot', 'getConstructorChampionSnapshot'] as const) {
    await assert.rejects(jolpica[method](1954, { strict: true, revalidate: 86400 }), invalid);
    assert.equal((await jolpica[method](1954, { strict: true, revalidate: 86400 })).standings[0]?.position, '1');
    assert.equal((await jolpica[method](1954, { strict: true, revalidate: 86400 })).standings[0]?.position, '1');
  }
  assert.deepEqual([...calls.values()], [2, 2]);
});
