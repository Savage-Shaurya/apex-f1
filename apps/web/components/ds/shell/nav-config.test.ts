import assert from 'node:assert/strict';
import { test } from 'node:test';
import { footerGroups, navSections } from './nav-config';

// Gate run (provider outage): with no confirmed results season, "Results" and "Season archive" both pointed at
// /results/archive, so the footer rendered two links to the same page and React warned about duplicate keys (href).
for (const season of [null, 2026]) {
  test(`footer groups never repeat a link within a group (results season ${season})`, () => {
    for (const g of footerGroups(season)) {
      const hrefs = g.links.map((l) => l.href);
      assert.deepEqual(hrefs, [...new Set(hrefs)], `${g.title}: ${hrefs.join(', ')}`);
    }
  });
  test(`menu sections never repeat a link within a section (results season ${season})`, () => {
    for (const s of navSections({ calendar: season, results: season })) {
      const hrefs = (s.links ?? []).map((l) => l.href);
      assert.deepEqual(hrefs, [...new Set(hrefs)], `${s.label}: ${hrefs.join(', ')}`);
    }
  });
}

test('footer keeps a way to the results archive during an outage', () => {
  const race = footerGroups(null).find((g) => g.title === 'Race');
  assert.ok(race?.links.some((l) => l.href === '/results/archive'));
});
