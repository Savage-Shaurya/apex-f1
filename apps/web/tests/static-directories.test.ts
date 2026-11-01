import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const [id, page] of [['TEAMS-1', 'app/teams/all/page.tsx'], ['TEAMS-1 (same cause)', 'app/drivers/all/page.tsx']] as const) {
  test(`${id}: ${page} is a static ISR page: its filters are read on the client, so revalidate takes effect`, () => {
    const source = read(page);
    // Awaiting searchParams made the route dynamic: `revalidate = 86400` was ignored and every visit
    // re-read the whole archive behind a 14-16 s grey skeleton (cache-control: private, no-store).
    assert.doesNotMatch(source, /searchParams/);
    assert.match(source, /export const revalidate = 86400/);
    assert.match(source, /<Suspense fallback=\{<\w+Fallback /, 'the static HTML carries the full, unfiltered directory');
  });
}
