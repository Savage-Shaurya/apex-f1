import test from 'node:test';
import assert from 'node:assert/strict';
import { jolpica, type FetchOpts } from '../src/jolpica/client';
import { ProviderError } from '../src/transport';

type Dataset = 'Results' | 'QualifyingResults' | 'SprintResults' | 'PitStops' | 'Laps';
const methods: { name: string; dataset: Dataset; call: (season: number, round: number, opts: FetchOpts) => Promise<unknown>; empty: null | never[] }[] = [
  { name: 'race results', dataset: 'Results', call: jolpica.getRaceResults, empty: null },
  { name: 'qualifying', dataset: 'QualifyingResults', call: jolpica.getQualifying, empty: [] },
  { name: 'full qualifying', dataset: 'QualifyingResults', call: jolpica.getQualifyingFull, empty: [] },
  { name: 'sprint', dataset: 'SprintResults', call: jolpica.getSprint, empty: [] },
  { name: 'pit stops', dataset: 'PitStops', call: jolpica.getPitStops, empty: [] },
  { name: 'laps', dataset: 'Laps', call: jolpica.getLaps, empty: [] },
];

const driver = (index: number) => ({ driverId: `fixture_${index}`, givenName: 'Fixture', familyName: String(index) });
function entries(dataset: Dataset, count: number, offset: number): unknown[] {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = offset + index;
    if (dataset === 'PitStops') return { driverId: driver(id).driverId, lap: '1', stop: '1', time: '12:00:00', duration: '20.000' };
    if (dataset === 'Laps') return { driverId: driver(id).driverId, position: String(id + 1), time: '1:30.000' };
    return { number: String(id + 1), position: String(id + 1), positionText: String(id + 1), points: '0', Driver: driver(id) };
  });
  return dataset === 'Laps' ? [{ number: '1', Timings: rows }] : rows;
}
function response(dataset: Dataset, options: { season?: string; round?: string; tableSeason?: string; tableRound?: string; offset?: number; total?: number; empty?: boolean } = {}) {
  const season = options.season ?? '2024';
  const round = options.round ?? '1';
  const offset = options.offset ?? 0;
  const total = options.empty ? 0 : options.total ?? 1;
  const Races = options.empty ? [] : [{
    season, round, raceName: 'Fixture race', date: '2024-01-01',
    Circuit: { circuitId: 'fixture', circuitName: 'Fixture circuit', Location: { lat: '1', long: '2', locality: 'Fixture', country: 'Fixture' } },
    [dataset]: entries(dataset, Math.min(100, total - offset), offset),
  }];
  return new Response(JSON.stringify({ MRData: { limit: '100', offset: String(offset), total: String(total), RaceTable: {
    season: options.tableSeason ?? season, round: options.tableRound ?? round, Races,
  } } }), { status: 200, headers: { 'content-type': 'application/json' } });
}
const invalidResponse = (error: unknown) => error instanceof ProviderError && error.provider === 'jolpica' && error.code === 'invalid-response';
const invalidInput = (error: unknown) => error instanceof ProviderError && error.provider === 'jolpica' && error.code === 'invalid-input';

for (const method of methods) {
  test(`${method.name} rejects foreign row and envelope identities in strict and render modes`, async () => {
    for (const identity of [{ season: '2023', tableSeason: '2024' }, { round: '2', tableRound: '1' }, { tableSeason: '2023' }, { tableRound: '2' }]) {
      const fetchImpl: typeof fetch = async () => response(method.dataset, identity);
      await assert.rejects(method.call(2024, 1, { strict: true, fetchImpl }), invalidResponse);
      assert.deepEqual(await method.call(2024, 1, { fetchImpl }), method.empty);
    }
  });

  test(`${method.name} discards all prior pages when a later page identifies another race`, async () => {
    const offsets: number[] = [];
    const fetchImpl: typeof fetch = async input => {
      const offset = Number(new URL(String(input)).searchParams.get('offset'));
      offsets.push(offset);
      return response(method.dataset, { offset, total: 101, round: offset === 0 ? '1' : '2', tableRound: '1' });
    };
    await assert.rejects(method.call(2024, 1, { strict: true, fetchImpl }), invalidResponse);
    assert.deepEqual(offsets, [0, 100]);
    assert.deepEqual(await method.call(2024, 1, { fetchImpl }), method.empty);
  });

  test(`${method.name} keeps matching data and legitimate empty future datasets`, async () => {
    const matching = await method.call(2024, 1, { strict: true, fetchImpl: async () => response(method.dataset) });
    if (Array.isArray(matching)) assert.equal(matching.length, 1);
    else assert.equal((matching as { results: unknown[] }).results.length, 1);
    const future = new Date().getUTCFullYear() + 1;
    assert.deepEqual(await method.call(future, 1, { strict: true, fetchImpl: async () => response(method.dataset, { season: String(future), empty: true }) }), method.empty);
  });
}

test('Race detail input validation rejects malformed coordinates before any provider request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; throw new Error('Invalid requests must never reach fetch.'); };
  for (const method of methods) {
    for (const [season, round] of [[1949, 1], [new Date().getUTCFullYear() + 2, 1], [Number.NaN, 1], [2024.5, 1], [2024, 0], [2024, -1], [2024, 1.5], [2024, Number.NaN], [2024, Number.MAX_SAFE_INTEGER + 1]]) {
      await assert.rejects(method.call(season!, round!, { strict: true, fetchImpl }), invalidInput);
      assert.deepEqual(await method.call(season!, round!, { fetchImpl }), method.empty);
    }
  }
  assert.equal(calls, 0);
});
