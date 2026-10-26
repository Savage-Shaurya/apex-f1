import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRace, raceRouteSlug, resolveRaceRoute } from '../src/jolpica/mappers';
import type { JolpicaRace } from '../src/jolpica/types';

export const repeatedVenue: JolpicaRace[] = [
  { season: '2020', round: '4', raceName: 'British Grand Prix', date: '2020-08-02', time: '13:10:00Z', url: 'https://example.invalid/british', Circuit: { circuitId: 'silverstone', circuitName: 'Silverstone Circuit', url: 'https://example.invalid/silverstone', Location: { lat: '52.0786', long: '-1.01694', locality: 'Silverstone', country: 'UK' } } },
  { season: '2020', round: '5', raceName: '70th Anniversary Grand Prix', date: '2020-08-09', time: '13:10:00Z', url: 'https://example.invalid/anniversary', Circuit: { circuitId: 'silverstone', circuitName: 'Silverstone Circuit', url: 'https://example.invalid/silverstone', Location: { lat: '52.0786', long: '-1.01694', locality: 'Silverstone', country: 'UK' } } },
];

test('Repeated 2020 venue visits have unique public links and resolve to their respective rounds', () => {
  const races = repeatedVenue.map(mapRace);
  assert.deepEqual(races.map(race => `/schedule/${race.season}/${race.routeSlug ?? race.slug}`), [
    '/schedule/2020/silverstone-round-4', '/schedule/2020/silverstone-round-5',
  ]);
  assert.equal(resolveRaceRoute(races, 'silverstone-round-4')?.name, 'British Grand Prix');
  assert.equal(resolveRaceRoute(races, 'silverstone-round-5')?.name, '70th Anniversary Grand Prix');
  assert.equal(resolveRaceRoute(races, 'silverstone-round-4')?.round, 4);
  assert.equal(resolveRaceRoute(races, 'silverstone-round-5')?.round, 5);
  assert.deepEqual(races.map(race => [race.slug, race.circuitId, race.season, race.round]), [
    ['silverstone', 'silverstone', 2020, 4], ['silverstone', 'silverstone', 2020, 5],
  ]);
});

test('Legacy circuit links retain the earliest visit even when a source array is reordered', () => {
  const races = repeatedVenue.map(mapRace).reverse();
  assert.equal(resolveRaceRoute(races, 'silverstone')?.round, 4);
  assert.deepEqual(races.map(race => race.round), [5, 4]);
});

test('Manually constructed races without routeSlug retain legacy link resolution', () => {
  const legacy = repeatedVenue.map(mapRace).map(({ routeSlug: _routeSlug, ...race }) => race);
  assert.equal(resolveRaceRoute(legacy, 'silverstone')?.round, 4);
  assert.equal(resolveRaceRoute(legacy, 'silverstone-round-5')?.round, 5);
});

test('Unknown round keys and malformed route segments never alias an existing race', () => {
  const races = repeatedVenue.map(mapRace);
  for (const key of ['silverstone-round-6', 'silverstone-round-04', '../silverstone', 'silverstone/round-4', 'x'.repeat(161)]) {
    assert.equal(resolveRaceRoute(races, key), null);
  }
});

test('Route key generation accepts stable circuit IDs and rejects invalid identities', () => {
  assert.equal(raceRouteSlug('red_bull-ring', 1), 'red_bull-ring-round-1');
  assert.throws(() => raceRouteSlug('../silverstone', 4));
  assert.throws(() => raceRouteSlug('silverstone', 0));
  assert.throws(() => raceRouteSlug('silverstone', 4.5));
});
