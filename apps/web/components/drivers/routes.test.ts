import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Guards the People routes against a soft 404. A loading.tsx above a page
 * makes its response stream, so a notFound() thrown by that page ships as
 * HTTP 200. The [slug] layouts decide existence instead, so no loading
 * boundary may sit between the app root and those layouts.
 */
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');

for (const area of ['drivers', 'teams']) {
  test(`${area}/[slug] decides existence above every loading boundary`, () => {
    assert.ok(existsSync(path.join(app, area, '[slug]', 'layout.tsx')), 'existence gate layout is missing');
    for (const dir of ['', area, `${area}/[slug]`]) {
      assert.equal(existsSync(path.join(app, dir, 'loading.tsx')), false, `app/${dir}/loading.tsx would stream the [slug] routes`);
    }
    assert.ok(existsSync(path.join(app, area, '(index)', 'loading.tsx')), 'the index skeleton lives in the (index) group');
  });
}

for (const area of ['drivers', 'teams']) {
  test(`${area}/[slug] answers a provider outage with a 5xx, not a 200 unavailable page (SEO-2)`, async () => {
    const { readFileSync } = await import('node:fs');
    const layout = readFileSync(path.join(app, area, '[slug]', 'layout.tsx'), 'utf8');
    // The only non-throwing exit is the build-time one (no good copy exists yet, a throw would fail the
    // deploy, F-01): `if (await outageDuringBuild()) return children;`. Any other return is a 200 outage page.
    const runtime = layout.replace(/if \(await outageDuringBuild\(\)\) return children;/, '');
    assert.match(runtime, /state === 'unavailable'\)\s*(?:\{(?:(?!\breturn\b)[\s\S])*?)?throw new PeopleSourceOutage/);
    assert.ok(existsSync(path.join(app, area, 'error.tsx')), `app/${area}/error.tsx must render the truthful outage state`);
  });
}

test('the retired Hall of Fame path redirects permanently (SEO-8)', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(path.join(app, 'drivers', 'hall-of-fame', 'page.tsx'), 'utf8');
  assert.match(page, /permanentRedirect\('\/drivers\/champions'\)/);
});
