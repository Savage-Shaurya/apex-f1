import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPredictionRaceContext } from './prediction-race-context';

const circuit = { circuitId: 'albert_park', circuitName: 'Albert Park Grand Prix Circuit', Location: { lat: '-37.8497', long: '144.968', locality: 'Melbourne', country: 'Australia' } };
function envelope(table: Record<string, unknown>) {
  return { MRData: { xmlns: '', series: 'f1', url: '', limit: '100', offset: '0', total: '1', ...table } };
}

test('BE-2: fifty prediction saves spend at most two physical Jolpica requests', async (t) => {
  if (process.env.UPSTASH_REDIS_REST_URL) return t.skip('shared admission configured in this shell');
  const original = globalThis.fetch;
  let physical = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    physical++;
    const url = String(input);
    if (url.includes('/drivers.json')) return Response.json(envelope({ DriverTable: { season: '2019', Drivers: [{ driverId: 'hamilton', givenName: 'Lewis', familyName: 'Hamilton' }] } }));
    return Response.json(envelope({ RaceTable: { season: '2019', Races: [{ season: '2019', round: '1', raceName: 'Australian Grand Prix', date: '2019-03-17', time: '05:10:00Z', Circuit: circuit, Qualifying: { date: '2019-03-16', time: '06:00:00Z' } }] } }));
  }) as typeof fetch;
  try {
    for (let save = 0; save < 50; save++) {
      const context = await readPredictionRaceContext(2019, 1);
      assert.equal(context.race?.round, 1);
      assert.ok(context.eligibleDriverIds.has('hamilton'));
    }
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(physical <= 2, `expected at most 2 physical requests, saw ${physical}`);
});
