import assert from 'node:assert/strict';
import { test } from 'node:test';
import LiveIndex from '../app/live/page';
import SeasonIndex from '../app/results/[season]/page';
import Membership from '../app/membership/page';
import Account from '../app/account/page';
import { siteOrigin } from '../components/shell/site-metadata';

async function target(run: () => unknown): Promise<string> {
  try { await run(); } catch (error) {
    const digest = String((error as { digest?: string }).digest ?? '');
    assert.match(digest, /^NEXT_REDIRECT;/, `expected a redirect, got ${digest || String(error)}`);
    return digest.split(';')[2]!;
  }
  throw new Error('page did not redirect');
}

test('parent routes redirect to real child pages', async () => {
  assert.equal(await target(() => LiveIndex()), '/live/timing');
  // /results follows getSeasonContext().resultsSeason (provider-backed; covered by lib/season tests and the browser check).
  assert.equal(await target(() => SeasonIndex({ params: Promise.resolve({ season: '2019' }) })), '/results/2019/drivers');
});

test('a non-year season segment is not redirected', async () => {
  await assert.rejects(async () => { await SeasonIndex({ params: Promise.resolve({ season: 'abc' }) }); }, (error: { digest?: string }) => /NEXT_(HTTP_ERROR_FALLBACK|NOT_FOUND)/.test(String(error.digest)));
});

test('retired membership and account pages redirect to /support (Give back, user decision 2026-10-25)', async () => {
  assert.equal(await target(() => Membership()), '/support');
  assert.equal(await target(() => Account()), '/support');
});

test('site origin comes from NEXT_PUBLIC_SITE_URL and ignores unsafe values', () => {
  const saved = { site: process.env.NEXT_PUBLIC_SITE_URL, vercel: process.env.VERCEL_PROJECT_PRODUCTION_URL };
  try {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test/path';
    assert.equal(siteOrigin(), 'https://example.test');
    process.env.NEXT_PUBLIC_SITE_URL = 'https://user:pw@example.test';
    assert.equal(siteOrigin(), 'http://localhost:3000', 'unsafe values are never published (local fallback outside production)');
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'apex.example.test';
    assert.equal(siteOrigin(), 'http://localhost:3000', 'the Vercel host is not a second source');
  } finally {
    for (const [key, value] of [['NEXT_PUBLIC_SITE_URL', saved.site], ['VERCEL_PROJECT_PRODUCTION_URL', saved.vercel]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('a foreign *.vercel.app site URL stops a production deployment; custom domains and the own host are honoured', () => {
  const prod = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'apex-new.vercel.app' };
  assert.throws(() => siteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://apex-f1.vercel.app' }), /foreign-vercel-host/);
  assert.equal(siteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://apex-new.vercel.app' }), 'https://apex-new.vercel.app');
  assert.equal(siteOrigin({ ...prod, NEXT_PUBLIC_SITE_URL: 'https://apex.example' }), 'https://apex.example');
  assert.equal(siteOrigin({ NEXT_PUBLIC_SITE_URL: 'https://apex-f1.vercel.app' }), 'https://apex-f1.vercel.app');
});
