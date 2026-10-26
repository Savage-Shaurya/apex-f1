import assert from 'node:assert/strict';
import test from 'node:test';
import { rankSearch, scoreSearchItem, type RankableSearchItem } from './search-rank';

// Shapes mirror app/search/page.tsx rows built from Jolpica (driverId as slug).
const d = (slug: string, title: string, meta: string, current = false): RankableSearchItem => ({ kind: 'driver', slug, title, meta, current });
const corpus: RankableSearchItem[] = [
  d('max_verstappen', 'Max Verstappen', 'VER · Red Bull · P4 · 221 pts', true),
  d('leclerc', 'Charles Leclerc', 'LEC · Ferrari · P5 · 215 pts', true),
  d('hamilton', 'Lewis Hamilton', 'HAM · Ferrari · P3 · 229 pts', true),
  { kind: 'team', slug: 'ferrari', title: 'Ferrari', meta: 'Italian · P2 · 444 pts', current: true },
  { kind: 'race', slug: 'monaco-round-6', title: 'Monaco Grand Prix', meta: 'R6 · Monaco · Monte-Carlo · Circuit de Monaco', current: true },
  { kind: 'race', slug: 'silverstone-round-9', title: 'British Grand Prix', meta: 'R9 · UK · Silverstone · Silverstone Circuit', current: true },
  d('bernard', 'Éric Bernard', 'French · F1 driver'),
  d('bettenhausen', 'Tony Bettenhausen', 'American · F1 driver'),
  d('boutsen', 'Thierry Boutsen', 'Belgian · F1 driver'),
  d('bruno_senna', 'Bruno Senna', 'Brazilian · F1 driver'),
  d('senna', 'Ayrton Senna', 'Brazilian · F1 driver'),
  d('verstappen', 'Jos Verstappen', 'Dutch · F1 driver'),
  d('maldonado', 'Pastor Maldonado', 'Venezuelan · F1 driver'),
  d('belmondo', 'Paul Belmondo', 'French · F1 driver'),
  { kind: 'team', slug: 'monarch', title: 'Monarch', meta: 'American · Historical constructor' },
  { kind: 'race', slug: 'season-1988', title: '1988 Season', meta: 'Standings · results' },
];
const titles = (q: string) => rankSearch(corpus, q).items.map((item) => item.title);

test('Senna ranks Ayrton Senna first and lists only Sennas', () => {
  assert.deepEqual(titles('Senna'), ['Ayrton Senna', 'Bruno Senna']);
  assert.deepEqual(titles('senna'), ['Ayrton Senna', 'Bruno Senna']);
});

test('a current-season surname leads its historical namesake', () => {
  assert.deepEqual(titles('Verstappen'), ['Max Verstappen', 'Jos Verstappen']);
});

test('team, circuit and season queries put the exact record first with no fuzzy noise', () => {
  assert.deepEqual(titles('Ferrari'), ['Ferrari', 'Charles Leclerc', 'Lewis Hamilton']);
  assert.deepEqual(titles('Monaco'), ['Monaco Grand Prix']);
  assert.deepEqual(titles('Silverstone'), ['British Grand Prix']);
  assert.deepEqual(titles('1988'), ['1988 Season']);
});

test('prefixes match whole-word starts; accents and case are ignored', () => {
  assert.deepEqual(titles('verst'), ['Max Verstappen', 'Jos Verstappen']);
  assert.deepEqual(titles('eric bernard'), ['Éric Bernard']);
});

test('typos fall back to fuzzy matching only when nothing matches exactly', () => {
  const typo = rankSearch(corpus, 'Verstapen');
  assert.equal(typo.mode, 'fuzzy');
  assert.ok(typo.items.slice(0, 2).every((item) => item.title.endsWith('Verstappen')));
  assert.ok(!typo.items.some((item) => item.title === 'British Grand Prix'));
  assert.deepEqual(rankSearch(corpus, 'xyz123').items, []);
  assert.equal(rankSearch(corpus, '  ').mode, 'all');
});

test('scores are zero for unrelated rows', () => {
  assert.equal(scoreSearchItem(corpus[6]!, 'Senna'), 0);
});
