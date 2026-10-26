import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPredictionRaceContext } from './prediction-race-context';

const circuit = { circuitId: 'suzuka', circuitName: 'Suzuka Circuit', Location: { lat: '34.8431', long: '136.541', locality: 'Suzuka', country: 'Japan' } };

test('fifty prediction saves verify the race with at most two physical Jolpica requests', async () => {
  const original = globalThis.fetch;
  const season = 2019; // a season no other test in this process reads
  let physical = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    physical++;
    const url = new URL(String(input));
    const page = { offset: url.searchParams.get('offset') ?? '0', limit: '100' };
    if (url.pathname.endsWith(`/${season}.json`)) {
      return Response.json({ MRData: { total: '1', ...page, RaceTable: { season: String(season), Races: [{ season: String(season), round: '17', raceName: 'Japanese Grand Prix', date: '2019-10-13', time: '05:10:00Z', Circuit: circuit, Qualifying: { date: '2019-10-13', time: '01:00:00Z' } }] } } });
    }
    return Response.json({ MRData: { total: '1', ...page, DriverTable: { season: String(season), Drivers: [{ driverId: 'bottas', givenName: 'Valtteri', familyName: 'Bottas' }] } } });
  }) as typeof fetch;
  try {
    for (let i = 0; i < 50; i++) {
      const { race, eligibleDriverIds } = await readPredictionRaceContext(season, 17);
      assert.equal(race?.round, 17);
      assert.ok(eligibleDriverIds.has('bottas'));
    }
    assert.ok(physical <= 2, `physical requests: ${physical}`);
  } finally {
    globalThis.fetch = original;
  }
});
