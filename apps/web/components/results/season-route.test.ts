import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newestResultsSeason, parseResultsSeason } from './season-route';
import { footerGroups, navSections, resultsHref, searchSeasonSuggestions } from '../ds/shell/nav-config';
import { resolveSeasonContext } from '@apex/api-client/jolpica';

// R3-REG-1: during a Jolpica outage (calendar and standings both unreadable)
// the current season must not 404 and links must not point at a guessed year.
const now = Date.parse('2026-10-26T01:28:00Z');
const outage = resolveSeasonContext({ now, calendar: null, standings: null });

test('R3-REG-1: with both season reads failing, /results/<clock year>/* is not a 404', () => {
  assert.equal(outage.resultsSeasonConfirmed, false);
  assert.equal(outage.resultsSeason, 2025);
  const newest = newestResultsSeason(outage);
  assert.equal(newest, 2026);
  assert.equal(parseResultsSeason('2026', newest), 2026);
  assert.equal(parseResultsSeason('2027', newest), null);
});

test('R3-REG-1: a confirmed season still bounds /results URLs (no clock-year guess)', () => {
  const confirmed = { now, resultsSeason: 2025, resultsSeasonConfirmed: true };
  assert.equal(newestResultsSeason(confirmed), 2025);
  assert.equal(parseResultsSeason('2026', newestResultsSeason(confirmed)), null);
});

test('R3-REG-1: an unconfirmed season sends nav, footer and search to the archive, never a guessed year', () => {
  const seasons = { calendar: null, results: null };
  const results = navSections(seasons).find((section) => section.label === 'Results')!;
  assert.equal(results.href, '/results/archive');
  assert.ok(results.links.every((link) => !/\/results\/\d{4}\//.test(link.href)));
  assert.equal(footerGroups(null).flatMap((group) => group.links).find((link) => link.label === 'Results')!.href, '/results/archive');
  assert.deepEqual(searchSeasonSuggestions(seasons), []);
  assert.equal(resultsHref(2026, 'teams'), '/results/2026/teams');
  assert.equal(navSections({ calendar: 2026, results: 2026 }).find((section) => section.label === 'Results')!.href, '/results/2026/drivers');
});

test('outage: no nav section or footer group lists the same href twice (React keys are hrefs; gate saw a duplicate-key console error)', () => {
  for (const seasons of [{ calendar: null, results: null }, { calendar: 2026, results: null }, { calendar: 2026, results: 2026 }]) {
    for (const group of footerGroups(seasons.results)) {
      const hrefs = group.links.map((link) => link.href);
      assert.equal(new Set(hrefs).size, hrefs.length, `footer ${group.title} (results ${seasons.results}): ${hrefs.join(', ')}`);
    }
    for (const section of navSections(seasons)) {
      const hrefs = section.links.map((link) => link.href);
      assert.equal(new Set(hrefs).size, hrefs.length, `menu ${section.label} (results ${seasons.results}): ${hrefs.join(', ')}`);
    }
  }
  // The archive stays one tap away from the footer during the outage.
  assert.ok(footerGroups(null).flatMap((group) => group.links).some((link) => link.href === '/results/archive'));
});

test('outage policy: the current season table is prebuilt, with a bounded retry; a build-time outage prebuilds nothing', async () => {
  const { currentResultsSeasonParams } = await import('./season-route');
  const noWait = { sleep: async () => {} };
  let calls = 0;
  const flaky = async () => (++calls < 2 ? { state: 'unavailable' as const, snapshot: null } : { state: 'available' as const, snapshot: { season: '2026' } });
  assert.deepEqual(await currentResultsSeasonParams(flaky, noWait), [{ season: '2026' }]);
  assert.equal(calls, 2);
  assert.deepEqual(await currentResultsSeasonParams(async () => ({ state: 'unavailable' as const, snapshot: null }), noWait), []);
  assert.deepEqual(await currentResultsSeasonParams(async () => { throw new Error('socket hang up'); }, noWait), []);
});

test('outage policy: a season table throws a provider outage (stale-on-error) instead of rendering and caching an empty table', async () => {
  const { readFileSync } = await import('node:fs');
  const view = readFileSync(new URL('./StandingsView.tsx', import.meta.url), 'utf8');
  // At runtime the outage still throws; only during `next build` (no good copy yet, a throw fails
  // the deploy, F-01) the honest state is prerendered on a short revalidate.
  assert.match(view, /if \(read\.state === 'unavailable'\) \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*if \(await outageDuringBuild\(\)\) \{/);
  assert.match(view, /\n    providerOutage\(`\$\{season\} \$\{noun\} standings`\);\n  \}/);
  assert.doesNotMatch(view, /Standings unavailable/);
  for (const route of ['../../app/results/[season]/drivers/page.tsx', '../../app/results/[season]/teams/page.tsx']) {
    assert.match(readFileSync(new URL(route, import.meta.url), 'utf8'), /generateStaticParams\(\) \{\s*return currentResultsSeasonParams\(undefined, \{\}, standingsTableAnswers\('(?:drivers|teams)'\)\);/, route);
  }
});

test('F-01: when the season is known but its table cannot be read during the build, the path is skipped from the prebuild (not a crash)', async () => {
  const { currentResultsSeasonParams } = await import('./season-route');
  const known = async () => ({ state: 'available' as const, snapshot: { season: '2026' } });
  assert.deepEqual(await currentResultsSeasonParams(known, { sleep: async () => {} }, async () => false), []);
  assert.deepEqual(await currentResultsSeasonParams(known, { sleep: async () => {} }, async () => { throw new Error('rate-limit'); }), []);
  assert.deepEqual(await currentResultsSeasonParams(known, { sleep: async () => {} }, async () => true), [{ season: '2026' }]);
});
