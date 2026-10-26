import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { jolpica } from './client';
import { mapDriverStanding } from './mappers';

// Real provider rows (Lawson only), captured from Jolpica 2026-10-26: /2026/driverstandings.json and his 2026 race results.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/lawson-2026.json', import.meta.url), 'utf8')) as {
  standing: { Driver: { driverId: string }; Constructors: Array<{ constructorId: string; name: string }> } & Record<string, unknown>;
  races: Array<{ round: string; Results: Array<Record<string, unknown>> } & Record<string, unknown>>;
};

function envelope(table: Record<string, unknown>, total: number) {
  return { MRData: { series: 'f1', limit: '100', offset: '0', total: String(total), ...table } };
}

test('R3-DATA-1: the driver standings read names Lawson\'s current team from his latest race (RB), not the provider list order', async () => {
  const standings = envelope({ StandingsTable: { season: '2026', round: '18', StandingsLists: [{ season: '2026', round: '18', DriverStandings: [fixture.standing] }] } }, 1);
  const results = envelope({ RaceTable: { season: '2026', driverId: 'lawson', Races: fixture.races } }, fixture.races.length);
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    return Response.json(url.includes('/drivers/lawson/results') ? results : standings);
  }) as typeof fetch;
  const snapshot = await jolpica.getDriverStandingsSnapshot(2026, { strict: true, fetchImpl, deadlineMs: 2000, timeoutMs: 2000, fresh: true });
  const row = mapDriverStanding(snapshot.standings[0]!);
  assert.equal(row.constructorSlug, 'rb');
  assert.equal(row.constructorName, 'RB F1 Team');
  assert.deepEqual(row.constructors.map((t) => t.slug), ['red_bull', 'rb']);
  assert.equal(urls.filter((u) => u.includes('/drivers/lawson/results')).length, 1);
});

test('R3-DATA-1: a failed team-order read keeps the provider order and the table (strict page reads too)', async () => {
  const standings = envelope({ StandingsTable: { season: '2026', round: '18', StandingsLists: [{ season: '2026', round: '18', DriverStandings: [fixture.standing] }] } }, 1);
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.includes('/results') ? new Response('nope', { status: 500 }) : Response.json(standings);
  }) as typeof fetch;
  const snapshot = await jolpica.getDriverStandingsSnapshot(2026, { strict: true, fetchImpl, deadlineMs: 2000, timeoutMs: 500, fresh: true });
  assert.deepEqual(snapshot.standings[0]!.Constructors.map((t) => t.constructorId), ['rb', 'red_bull']);
});
