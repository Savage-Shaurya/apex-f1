import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCircuitInfobox } from '@apex/api-client/wikipedia';
import { circuitFactsKey, decideCircuitFacts, formatLapLength, loadCircuitFacts } from './facts';
import { isKnownRaceRouteKey } from './known-ids';

const MONACO = parseCircuitInfobox(`|layout = Grand Prix Circuit (2015–present)
|length_km = 3.337
|layout6 = 4th Variation (1986–1996) (Nouvelle chicane added)
|length6_km = 3.328`);
const LUSAIL = parseCircuitInfobox(`|layout = Grand Prix Circuit (2023–present)
|length_km = 5.419`);

test('race facts: length and outline follow the season layout', () => {
  const today = decideCircuitFacts({ circuitId: 'monaco', season: 2026 }, MONACO, 2026);
  assert.deepEqual({ ...today, layoutName: null }, { lengthKm: 3.337, lengthStatus: 'published', showOutline: true, layoutName: null });
  const historic = decideCircuitFacts({ circuitId: 'monaco', season: 1990 }, MONACO, 2026);
  assert.equal(historic.lengthKm, 3.328);
  assert.equal(historic.showOutline, false);
  assert.equal(formatLapLength(decideCircuitFacts({ circuitId: 'losail', season: 2026 }, LUSAIL, 2026)), '5.419 km');
});

test('no infobox length is "Not published"; an unread infobox is "Unavailable"', () => {
  const unpublished = decideCircuitFacts({ circuitId: 'monaco', season: 1960 }, MONACO, 2026);
  assert.equal(formatLapLength(unpublished), 'Not published');
  assert.equal(unpublished.showOutline, false);
  const unread = decideCircuitFacts({ circuitId: 'monaco', season: 2026 }, null, 2026);
  assert.equal(formatLapLength(unread), 'Unavailable');
  // Today's outline stays for the current season; history is hidden without proof.
  assert.equal(unread.showOutline, true);
  assert.equal(decideCircuitFacts({ circuitId: 'monaco', season: 1990 }, null, 2026).showOutline, false);
});

test('one infobox read serves the whole race list and failures degrade to unavailable', async () => {
  const races = [
    { circuitId: 'monaco', season: 2026, circuitWikiUrl: 'https://en.wikipedia.org/wiki/Circuit_de_Monaco' },
    { circuitId: 'losail', season: 2026, circuitWikiUrl: 'https://en.wikipedia.org/wiki/Losail_International_Circuit' },
  ];
  let reads = 0;
  const facts = await loadCircuitFacts(races, {
    now: Date.parse('2026-10-25T00:00:00Z'),
    reader: async (urls) => { reads++; assert.equal(urls.length, 2); return new Map([[urls[0]!, MONACO], [urls[1]!, LUSAIL]]); },
  });
  assert.equal(reads, 1);
  assert.equal(facts.get(circuitFactsKey(races[1]!))?.lengthKm, 5.419);
  const failed = await loadCircuitFacts(races, { now: Date.parse('2026-10-25T00:00:00Z'), reader: async () => { throw new Error('429'); } });
  assert.equal(failed.get(circuitFactsKey(races[0]!))?.lengthStatus, 'unavailable');
});

test('known race route keys during a calendar outage', () => {
  assert.equal(isKnownRaceRouteKey('monaco'), true);
  assert.equal(isKnownRaceRouteKey('americas-round-18'), true);
  assert.equal(isKnownRaceRouteKey('ain-diab'), true);
  assert.equal(isKnownRaceRouteKey('zzz'), false);
  assert.equal(isKnownRaceRouteKey('monaco-round-99'), false);
  assert.equal(isKnownRaceRouteKey('monaco-round-0'), false);
  assert.equal(isKnownRaceRouteKey('Monaco'), false);
});

const BAHRAIN = parseCircuitInfobox(`|layout = Grand Prix Circuit (2005–present)
|length_km = 5.412
|layout2 = Outer Circuit (2005–present)
|length2_km = 3.543`);

test('D2-CODE-QUALITY-1: 2020 Sakhir GP (round 16) uses the Outer Circuit; round 15 keeps the GP layout', async () => {
  const bahrain = { circuitId: 'bahrain', season: 2020, round: 15, circuitWikiUrl: 'https://en.wikipedia.org/wiki/Bahrain_International_Circuit' };
  const sakhir = { ...bahrain, round: 16 };
  assert.notEqual(circuitFactsKey(bahrain), circuitFactsKey(sakhir));
  const facts = await loadCircuitFacts([bahrain, sakhir], { now: Date.parse('2026-10-25T00:00:00Z'), reader: async (urls) => new Map([[urls[0]!, BAHRAIN]]) });
  assert.equal(facts.get(circuitFactsKey(bahrain))?.lengthKm, 5.412);
  const outer = facts.get(circuitFactsKey(sakhir))!;
  assert.equal(outer.lengthKm, 3.543);
  assert.equal(outer.showOutline, false);
  assert.equal(decideCircuitFacts(sakhir, null, 2026).showOutline, false);
});
