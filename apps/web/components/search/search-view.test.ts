import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupSearchResults, searchStatus, hasMark, shownMeta, initialSearchState, searchHref } from './search-view';
import { miniCircuit } from './search-glyph';

test('groups follow the best result of each kind and keep full totals', () => {
  const ranked = [
    { kind: 'team' as const, id: 1 },
    { kind: 'driver' as const, id: 2 },
    { kind: 'team' as const, id: 3 },
    { kind: 'driver' as const, id: 4 },
    { kind: 'race' as const, id: 5 },
  ];
  const groups = groupSearchResults(ranked, 3);
  assert.deepEqual(groups.map((g) => [g.kind, g.rows.map((r) => r.id), g.total]), [['team', [1, 3], 2], ['driver', [2], 2]]);
  assert.deepEqual(groupSearchResults(ranked, 0), []);
});

test('status line says what is shown, in words', () => {
  assert.equal(searchStatus({ query: '', total: 50, corpus: 1195, mode: 'all', season: 2026 }), 'Showing the 2026 season. Type to search all 1,195 records.');
  assert.equal(searchStatus({ query: 'Senna', total: 2, corpus: 1195, mode: 'exact', season: 2026 }), '2 results for “Senna”, exact matches first.');
  assert.equal(searchStatus({ query: 'Verstapen', total: 1, corpus: 1195, mode: 'fuzzy', season: 2026 }), '1 result for “Verstapen”. No exact match, so these are the closest spellings.');
  assert.equal(searchStatus({ query: 'zzz', total: 0, corpus: 1195, mode: 'fuzzy', season: null }), 'No results for “zzz”.');
});

test('circuit glyphs come from real geometry, thinned, and unknown circuits get none', () => {
  const glyph = miniCircuit('americas', 90);
  assert.ok(glyph);
  assert.ok(glyph.d.startsWith('M') && glyph.d.endsWith('Z'));
  assert.ok(glyph.d.split('L').length <= 91);
  assert.equal(miniCircuit('not-a-circuit'), null);
  assert.equal(miniCircuit(null), null);
});

test('rows only carry a mark that means something; the code is not printed twice', () => {
  const ant = { meta: 'ANT · Mercedes · P1 · 340 pts', code: 'ANT' };
  assert.equal(hasMark(ant), true);
  assert.equal(shownMeta(ant), 'Mercedes · P1 · 340 pts');
  // With a team colour the stripe is the mark, so the code stays in the meta line.
  assert.equal(shownMeta({ ...ant, accent: '#00d2be' }), ant.meta);
  const senna = { meta: 'Brazilian · Former F1 driver' };
  assert.equal(hasMark(senna), false);
  assert.equal(shownMeta(senna), senna.meta);
  assert.equal(hasMark({ meta: '', circuit: { d: 'M0 0', viewBox: '0 0 1 1' } }), true);
});

test('Back to a search restores the query from the address bar, not the cached first-visit props (D2-CLICK-PATHS-1)', () => {
  const all = () => true;
  // Cached render of the first visit: no query. The URL carries the last one.
  assert.deepEqual(initialSearchState(new URLSearchParams('q=monaco&type=race'), { query: '', kind: 'all' }, all), { query: 'monaco', kind: 'race' });
  assert.deepEqual(initialSearchState(new URLSearchParams('q=senna'), { query: '', kind: 'team' }, all), { query: 'senna', kind: 'all' });
  // An address without ?q= is a cleared search: a stale server prop never comes back on Back (R3-CLICK-3).
  assert.deepEqual(initialSearchState(new URLSearchParams(''), { query: 'norris', kind: 'driver' }, all), { query: '', kind: 'all' });
  // No address bar at all: the server props stand.
  assert.deepEqual(initialSearchState(null, { query: 'hamilton', kind: 'driver' }, all), { query: 'hamilton', kind: 'driver' });
  // A type the corpus does not have, or a made-up one, falls back to all.
  assert.equal(initialSearchState(new URLSearchParams('q=x&type=race'), { query: '', kind: 'all' }, (k) => k !== 'race').kind, 'all');
  assert.equal(initialSearchState(new URLSearchParams('q=x&type=planet'), { query: '', kind: 'all' }, all).kind, 'all');
});

test('shareable search URLs keep the path, other params and hash', () => {
  assert.equal(searchHref('/search', ' Kimi Antonelli ', 'driver'), '/search?q=Kimi+Antonelli&type=driver');
  assert.equal(searchHref('/search?q=old&type=team', '', 'all'), '/search');
  assert.equal(searchHref('/drivers/all?page=2#list', 'fangio', 'all'), '/drivers/all?page=2&q=fangio#list');
});
