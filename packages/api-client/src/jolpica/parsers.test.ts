import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpica, secureWikipediaUrl } from './client';

const circuit = { circuitId: 'monza', circuitName: 'Autodromo Nazionale di Monza', url: 'http://en.wikipedia.org/wiki/Monza_Circuit', Location: { lat: '45.6156', long: '9.28111', locality: 'Monza', country: 'Italy' } };
const driver = (id: string) => ({ driverId: id, givenName: 'Given', familyName: id, url: `http://en.wikipedia.org/wiki/${id}` });
const constructor = { constructorId: 'ferrari', name: 'Ferrari', url: 'http://en.wikipedia.org/wiki/Scuderia_Ferrari' };
const race = { season: '2024', round: '16', raceName: 'Italian Grand Prix', date: '2024-09-01', url: 'http://en.wikipedia.org/wiki/2024_Italian_Grand_Prix', Circuit: circuit };
function envelope(table: Record<string, unknown>, total: number) {
  return { MRData: { total: String(total), offset: '0', limit: '100', RaceTable: { season: '2024', round: '16', ...table } } };
}
const serve = (body: unknown): typeof fetch => async () => Response.json(body);

test('qualifying rows parse without a car number, including the upstream "None" spelling', async () => {
  const QualifyingResults = [
    { number: '16', position: '1', Driver: driver('leclerc'), Constructor: constructor, Q1: '1:20.000' },
    { position: '2', Driver: driver('sainz'), Constructor: constructor },
    { number: 'None', position: '3', Driver: driver('bearman'), Constructor: constructor },
  ];
  const rows = await jolpica.getQualifyingFull(2024, 16, { strict: true, fetchImpl: serve(envelope({ Races: [{ ...race, QualifyingResults }] }, 3)) });
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.number, '16');
  assert.equal(rows[1]!.number, undefined);
  assert.equal(rows[2]!.number, undefined);
});

test('sprint rows parse without a car number', async () => {
  const SprintResults = [
    { number: '1', position: '1', positionText: '1', points: '8', Driver: driver('max_verstappen'), Constructor: constructor },
    { position: '2', positionText: '2', points: '7', Driver: driver('norris'), Constructor: constructor },
  ];
  const rows = await jolpica.getSprint(2024, 16, { strict: true, fetchImpl: serve(envelope({ Races: [{ ...race, SprintResults }] }, 2)) });
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.number, undefined);
});

test('Wikipedia links from Jolpica are upgraded to https; other hosts are untouched', async () => {
  assert.equal(secureWikipediaUrl('http://en.wikipedia.org/wiki/Ayrton_Senna'), 'https://en.wikipedia.org/wiki/Ayrton_Senna');
  assert.equal(secureWikipediaUrl('http://wikipedia.org/'), 'https://wikipedia.org/');
  assert.equal(secureWikipediaUrl('https://en.wikipedia.org/wiki/X'), 'https://en.wikipedia.org/wiki/X');
  assert.equal(secureWikipediaUrl('http://wikipedia.org.evil.example/x'), 'http://wikipedia.org.evil.example/x');
  assert.equal(secureWikipediaUrl('http://example.com/wikipedia.org'), 'http://example.com/wikipedia.org');
  const Results = [{ number: '16', position: '1', positionText: '1', points: '25', Driver: driver('leclerc'), Constructor: constructor }];
  const result = await jolpica.getRaceResults(2024, 16, { strict: true, fetchImpl: serve(envelope({ Races: [{ ...race, Results }] }, 1)) });
  assert.equal(result!.race.url, 'https://en.wikipedia.org/wiki/2024_Italian_Grand_Prix');
  assert.equal(result!.race.Circuit.url, 'https://en.wikipedia.org/wiki/Monza_Circuit');
  assert.equal(result!.results[0]!.Driver.url, 'https://en.wikipedia.org/wiki/leclerc');
  assert.equal(result!.results[0]!.Constructor!.url, 'https://en.wikipedia.org/wiki/Scuderia_Ferrari');
  const drivers = await jolpica.getDriver('senna', { strict: true, fetchImpl: serve({ MRData: { total: '1', offset: '0', limit: '100', DriverTable: { driverId: 'senna', Drivers: [driver('senna')] } } }) });
  assert.equal(drivers!.url, 'https://en.wikipedia.org/wiki/senna');
});
