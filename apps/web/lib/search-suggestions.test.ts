import assert from 'node:assert/strict';
import test from 'node:test';
import { liveSearchSuggestions, matchingSearchSuggestions } from './search-suggestions';
import { rankSearch, type RankableSearchItem } from './search-rank';

const corpus: RankableSearchItem[] = [
  { kind: 'driver', slug: 'antonelli', title: 'Andrea Kimi Antonelli', meta: 'ANT · Mercedes · P1 · 340 pts', current: true },
  { kind: 'team', slug: 'mercedes', title: 'Mercedes', meta: 'German · P1 · 578 pts', current: true },
  { kind: 'race', slug: 'rodriguez-round-19', title: 'Mexico City Grand Prix', meta: 'R19 · Mexico · Mexico City · Autódromo Hermanos Rodríguez', current: true },
  { kind: 'race', slug: 'season-2025', title: '2025 Season', meta: 'Standings · results' },
];
const resolves = (term: string) => rankSearch(corpus, term).mode === 'exact';

test('an empty corpus has no claimed working suggestions', () => {
  assert.deepEqual(matchingSearchSuggestions(['Antonelli', 'Mercedes'], (term) => rankSearch([], term).mode === 'exact'), []);
});

test('live candidates are offered only when they resolve exactly, once each', () => {
  assert.deepEqual(matchingSearchSuggestions(['Antonelli', 'Mercedes', 'Mexico City', '2025', 'mercedes', ' ', 'Zzyzx'], resolves), ['Antonelli', 'Mercedes', 'Mexico City', '2025']);
});

test('no candidates means no suggestion chips rather than a hard-coded list', () => {
  assert.deepEqual(matchingSearchSuggestions([], resolves), []);
});

test('live candidates follow the standings and calendar, rolling to the last race after the finale', () => {
  const races = [
    { city: 'Austin', raceStartIso: '2026-10-25T19:00:00Z', season: 2026 },
    { city: 'Mexico City', raceStartIso: '2026-11-01T20:00:00Z', season: 2026 },
  ];
  const seasons = [{ season: '2024' }, { season: '2025' }, { season: '2026' }];
  const input = { leaderSurname: 'Antonelli', leadingTeam: 'Mercedes', races, seasons };
  assert.deepEqual(liveSearchSuggestions(input, Date.parse('2026-10-25T20:00:00Z')), ['Antonelli', 'Mercedes', 'Mexico City', '2025']);
  assert.deepEqual(liveSearchSuggestions(input, Date.parse('2026-12-31T00:00:00Z')), ['Antonelli', 'Mercedes', 'Mexico City', '2025']);
  assert.deepEqual(liveSearchSuggestions({ races: [], seasons: [] }), []);
});
