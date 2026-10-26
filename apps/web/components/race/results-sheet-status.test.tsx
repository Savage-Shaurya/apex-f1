import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mapResult, type JolpicaResultEntry } from '@apex/api-client/jolpica';

// The test runner compiles JSX with the classic runtime (tsconfig "jsx": "preserve" is for Next),
// which reads a global React; the component is imported after it is set.
(globalThis as { React?: typeof React }).React = React;
const { ResultsSheet } = await import('./ResultsSheet');

// Real Jolpica classifications, captured 2026-10-26 (fixtures/jolpica-<season>-<round>-results.json).
function classification(file: string) {
  const env = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as { MRData: { RaceTable: { Races: Array<{ raceName: string; season: string; Results: JolpicaResultEntry[] }> } } };
  const race = env.MRData.RaceTable.Races[0]!;
  return { name: race.raceName, season: Number(race.season), results: race.Results.map(mapResult) };
}

/** The rendered race table as rows of cell texts, keyed by driver surname. */
function renderedRows(file: string): Map<string, string[]> {
  const { name, season, results } = classification(file);
  const none = { state: 'not-covered' } as const;
  const html = renderToStaticMarkup(
    <ResultsSheet raceName={name} season={season} race={{ state: 'available', results }} sprint={none as never} qualifying={none as never} pitStops={none as never} colourOf={() => null} retryHref="/" raceStartIso={`${season}-01-01T00:00:00Z`} offsetMin={null} raceDone sessionOrder={["Q", "R"]} />,
  );
  const rows = new Map<string, string[]>();
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map((c) => c.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim());
    const driver = results.find((r) => cells.some((c) => c.includes(r.driver.lastName)));
    if (driver && !rows.has(driver.driver.lastName)) rows.set(driver.driver.lastName, cells);
  }
  return rows;
}

test('R3-DATA-2: drivers who withdrew after running laps are not "DNS" (Japan 1976, Imola 1994)', () => {
  const fuji = renderedRows('jolpica-1976-16-results.json');
  for (const name of ['Lauda', 'Fittipaldi', 'Pace', 'Perkins']) {
    const row = fuji.get(name)!;
    assert.ok(row, name);
    assert.equal(row[0], 'WD', `${name}: ${row.join(' | ')}`);
  }
  assert.equal(renderedRows('jolpica-1994-3-results.json').get('Comas')![0], 'WD');
});

test('R3-DATA-2/3: cars that never started read DNS with no grid slot, not a pit-lane start', () => {
  const imola = renderedRows('jolpica-1994-3-results.json');
  for (const name of ['Ratzenberger', 'Barrichello']) {
    const row = imola.get(name)!;
    assert.equal(row[0], 'DNS', `${name}: ${row.join(' | ')}`);
    assert.ok(!row.includes('PL') && !row.includes('Pit lane'), `${name}: ${row.join(' | ')}`);
  }
  const ireland = renderedRows('jolpica-1961-1-results.json').get('Ireland')!;
  assert.equal(ireland[0], 'DNS');
  assert.ok(!ireland.includes('PL') && !ireland.includes('Pit lane'), ireland.join(' | '));
  const modena = renderedRows('jolpica-1988-3-results.json').get('Modena')!;
  assert.ok(!modena.includes('PL') && !modena.includes('Pit lane'), modena.join(' | '));
});

test('lapped cars show "+1 lap", not the provider\'s time-like gap (2026 United States GP)', () => {
  const austin = renderedRows('jolpica-2026-18-results.json');
  const lindblad = austin.get('Lindblad')!;
  assert.ok(lindblad.some((c) => c.startsWith('+1 lap')), lindblad.join(' | '));
  assert.ok(!lindblad.some((c) => c.includes('+6.344')), lindblad.join(' | '));
  assert.ok(austin.get('Leclerc')!.some((c) => c.includes('+13.078')));
});
