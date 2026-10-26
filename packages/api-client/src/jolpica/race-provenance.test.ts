import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapRace } from './mappers';
import type { JolpicaRace } from './types';

test('schedule mapping keeps separate race and circuit source articles', () => {
  const raw: JolpicaRace = {
    season: '2026', round: '1', raceName: 'Fixture Grand Prix', date: '2026-03-01',
    url: 'https://en.wikipedia.org/wiki/2026_Fixture_Grand_Prix',
    Circuit: {
      circuitId: 'fixture', circuitName: 'Fixture Circuit', url: 'https://en.wikipedia.org/wiki/Fixture_Circuit',
      Location: { lat: '1', long: '2', locality: 'Fixture', country: 'Fixture' },
    },
  };
  const mapped = mapRace(raw);
  assert.equal(mapped.wikiUrl, raw.url);
  assert.equal(mapped.circuitWikiUrl, raw.Circuit.url);
  assert.equal(mapRace({ ...raw, Circuit: { ...raw.Circuit, url: '' } }).circuitWikiUrl, undefined);
});
