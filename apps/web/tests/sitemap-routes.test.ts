import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import sitemap from '../app/sitemap';
import robots from '../app/robots';

const circuit = (id: string) => ({ circuitId: id, circuitName: id, url: `http://en.wikipedia.org/wiki/${id}`, Location: { lat: '52.07', long: '-1.01', locality: 'X', country: 'Y' } });
const race = (season: number, round: number, id: string, date: string) => ({ season: String(season), round: String(round), raceName: `${id} GP`, date, time: '14:00:00Z', url: 'http://en.wikipedia.org/wiki/GP', Circuit: circuit(id) });
const driver = (id: string) => ({ driverId: id, givenName: 'G', familyName: id });
const constructor = { constructorId: 'ferrari', name: 'Ferrari' };
const page = (url: URL, total: number, body: Record<string, unknown>) => ({ MRData: { total: String(total), offset: url.searchParams.get('offset') ?? '0', limit: '100', ...body } });

const original = globalThis.fetch;
after(() => { globalThis.fetch = original; });
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^.*\/f1\//, '');
  if (path === 'current.json') {
    const Races = [race(2026, 1, 'albert_park', '2026-03-08'), race(2026, 24, 'yas_marina', '2026-12-06')];
    return Response.json(page(url, Races.length, { RaceTable: { season: '2026', Races } }));
  }
  if (path === 'current/driverStandings.json') {
    const DriverStandings = [{ position: '1', positionText: '1', points: '300', wins: '7', Driver: driver('norris'), Constructors: [constructor] }];
    return Response.json(page(url, 1, { StandingsTable: { season: '2026', StandingsLists: [{ season: '2026', round: '19', DriverStandings }] } }));
  }
  if (path === 'drivers.json') return Response.json(page(url, 1, { DriverTable: { Drivers: [driver('senna')] } }));
  if (path === 'constructors.json') return Response.json(page(url, 1, { ConstructorTable: { Constructors: [constructor] } }));
  if (path === 'seasons.json') {
    const Seasons = [1950, 1957, 1958, 2025, 2026].map(year => ({ season: String(year), url: 'https://en.wikipedia.org/wiki/x' }));
    return Response.json(page(url, Seasons.length, { SeasonTable: { Seasons } }));
  }
  if (path === 'results/1.json') {
    const Races = [
      { ...race(1950, 1, 'silverstone', '1950-05-13'), Results: [{ number: '2', position: '1', positionText: '1', points: '9', Driver: driver('farina'), Constructor: { constructorId: 'alfa', name: 'Alfa Romeo' } }] },
      { ...race(2025, 1, 'albert_park', '2025-03-16'), Results: [{ number: '4', position: '1', positionText: '1', points: '25', Driver: driver('norris'), Constructor: constructor }] },
    ];
    return Response.json(page(url, 2, { RaceTable: { position: '1', Races } }));
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

test('sitemap lists historical race pages, team tables only from 1958, and no search page', async () => {
  const urls = (await sitemap()).map(entry => new URL(entry.url).pathname);
  assert.ok(urls.includes('/schedule/1950/silverstone-round-1'), 'historical race page listed');
  assert.ok(urls.includes('/schedule/2025/albert_park-round-1'));
  assert.ok(urls.includes('/schedule/2026/yas_marina-round-24'), 'current calendar still listed');
  assert.ok(urls.includes('/results/1957/drivers'));
  assert.ok(!urls.includes('/results/1957/teams'), 'no constructors table before 1958');
  assert.ok(!urls.includes('/results/1950/teams'));
  assert.ok(urls.includes('/results/1958/teams'));
  assert.ok(!urls.includes('/search'));
  assert.ok(urls.includes('/support'));
  assert.ok(urls.includes('/drivers/senna'));
});

test('robots names the sitemap and emits no non-standard Host line', () => {
  const rules = robots();
  assert.equal('host' in rules, false);
  assert.match(String(rules.sitemap), /\/sitemap-index\.xml$/);
});
