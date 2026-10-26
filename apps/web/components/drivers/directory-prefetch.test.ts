import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * The all-drivers and all-constructors directories list hundreds of rows. A
 * viewport prefetch per row rendered each (mostly uncached, historic) detail
 * page and spent the shared Jolpica budget on every visit, so prefetches came
 * back as HTTP 500s once it ran out (quality gate, /drivers/all). Rows load
 * their page on tap instead.
 */
for (const file of ['./Directory.tsx', '../teams/directory/TeamDirectory.tsx']) {
  test(`${file}: directory rows do not prefetch`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const rows = [...source.matchAll(/<Link href=\{it\.href\}[^>]*>/g)].map((m) => m[0]);
    assert.ok(rows.length > 0, 'row links found');
    for (const row of rows) assert.match(row, /prefetch=\{false\}/);
  });
}

// The same holds for the other large link grids: every season in the archive (two tables each) and
// every champion in the halls (drivers and constructors share these components). In the production
// gate run their viewport prefetches returned HTTP 500s once the provider budget was spent.
for (const file of ['../results/ArchiveView.tsx', './hall/ChampionsHall.tsx', './hall/DriverHall.tsx']) {
  test(`${file}: grid links do not prefetch`, () => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const links = [...source.matchAll(/<Link\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(links.length > 0, 'grid links found');
    for (const link of links) assert.match(link, /prefetch=\{false\}/, link.slice(0, 80));
  });
}
