import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpicaKeyIsImmutable } from './last-good';
import { jolpicaAdmissionPrefix } from './shared-admission';

// Production 2026-10-27: three deploys' prerenders spent the live site's 500-an-hour Jolpica
// budget, and driver/team identity had no usable last-good copy (older than 6 h), so every
// uncached driver and team page answered 500 for up to an hour.
const NOW = Date.UTC(2026, 9, 27, 2, 0, 0);
const BASE = 'https://api.jolpi.ca/ergast/f1';

test('a driver, constructor or circuit identity record may be served from last-good at any age', () => {
  for (const path of ['drivers/hamilton.json', 'constructors/ferrari.json', 'circuits/rodriguez.json', 'drivers/max_verstappen.json?limit=100']) {
    assert.equal(jolpicaKeyIsImmutable(`${BASE}/${path}`, NOW), true, path);
  }
  for (const path of ['drivers.json', 'current/drivers.json', '2026/drivers.json', 'drivers/hamilton/results.json', '2026/constructors/ferrari/results.json']) {
    assert.equal(jolpicaKeyIsImmutable(`${BASE}/${path}`, NOW), false, path);
  }
});

test('next build spends its own Jolpica budget, never the live site\'s', () => {
  const build = { NEXT_PHASE: 'phase-production-build' };
  assert.equal(jolpicaAdmissionPrefix({ VERCEL_ENV: 'production' }), 'apex:jolpica:v1:{jolpica}');
  assert.equal(jolpicaAdmissionPrefix({ VERCEL_ENV: 'production', ...build }), 'apex:build:jolpica:v1:{jolpica}');
  assert.equal(jolpicaAdmissionPrefix({ VERCEL_ENV: 'preview', ...build }), 'apex:preview-build:jolpica:v1:{jolpica}');
  assert.equal(jolpicaAdmissionPrefix({ VERCEL_ENV: 'preview' }), 'apex:preview:jolpica:v1:{jolpica}');
});
