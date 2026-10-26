import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from './client';
import { persistRaceWeekend, type RaceScheduleInput } from './ingestion';

test('schedule persistence never overwrites venue provenance with a race article or an absent venue source', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  delete process.env.DATABASE_SSL_CA_PATH;
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const originalBegin = client.begin;
  const statements: { query: string; parameters: unknown[] }[] = [];
  const circuitId = '10000000-0000-4000-8000-000000000001';
  const raceId = '20000000-0000-4000-8000-000000000001';
  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    // Transaction-local timeouts (bounded-transaction.ts) open every transaction; no fixture state.
    if (/^select set_config\('statement_timeout'/.test(query)) { const none = Promise.resolve([]); return Object.assign(none, { values: () => none }); }
    if (/^select pg_advisory_xact_lock/.test(query)) {
      const result = Promise.resolve([]);
      return Object.assign(result, { values: () => result });
    }
    statements.push({ query, parameters });
    if (!/^insert into "(?:circuit|race)"/.test(query)) throw new Error('Fixture rejects every unrelated statement.');
    const result = Promise.resolve([{ id: query.startsWith('insert into "circuit"') ? circuitId : raceId }]);
    return Object.assign(result, { values: () => result.then((rows) => rows.map((row) => Object.values(row))) });
  });
  Reflect.set(client, 'begin', async (callback: (connection: typeof client) => Promise<unknown>) => callback(client));
  const input: RaceScheduleInput = {
    circuitId: 'fixture', circuitName: 'Fixture Circuit', lat: 1, lon: 2, season: 2026, round: 1,
    slug: 'fixture', name: 'Fixture Grand Prix', country: 'Fixture', city: 'Fixture',
    wikiUrl: 'https://en.wikipedia.org/wiki/2026_Fixture_Grand_Prix',
    circuitWikiUrl: 'https://en.wikipedia.org/wiki/Fixture_Circuit', raceStartIso: '2026-03-01', sessions: [],
  };
  try {
    assert.deepEqual(await persistRaceWeekend(input), { raceId });
    const venueStatement = statements[0]!;
    const raceStatement = statements[1]!;
    assert.equal(venueStatement.parameters.includes(input.circuitWikiUrl), true);
    assert.equal(venueStatement.parameters.includes(input.wikiUrl), false);
    assert.equal(raceStatement.parameters.includes(input.wikiUrl), true);
    assert.equal(raceStatement.parameters.includes(input.circuitWikiUrl), false);
    assert.match(raceStatement.query.split('do update set')[1] ?? '', /"date_start" = case[\s\S]*at time zone 'UTC'/);
    statements.length = 0;
    await persistRaceWeekend({ ...input, raceStartIso: '2026-03-01T23:45:00Z' });
    assert.doesNotMatch(statements[1]!.query.split('do update set')[1] ?? '', /"date_start" = case/);
    for (const circuitWikiUrl of [undefined, '']) {
      statements.length = 0;
      await persistRaceWeekend({ ...input, circuitWikiUrl });
      const statement = statements[0]!;
      // Drizzle lists all columns in INSERT, but omitted fields use DEFAULT;
      // the important preservation rule is no wiki_url assignment on conflict.
      assert.doesNotMatch(statement.query.split('do update set')[1] ?? '', /"wiki_url"\s*=/);
      assert.equal(statement.parameters.includes(input.wikiUrl), false);
    }
  } finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    Reflect.set(client, 'begin', originalBegin);
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
});
