import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settleWithin } from './settle-within';

test('VI-02: display enrichment answers within its budget: a slow, failed or hung read becomes the fallback', async () => {
  assert.deepEqual(await settleWithin(Promise.resolve([1]), 50, []), [1]);
  assert.deepEqual(await settleWithin(Promise.reject(new Error('down')), 50, []), []);
  const started = Date.now();
  assert.deepEqual(await settleWithin(new Promise<number[]>(() => {}), 40, []), []);
  assert.ok(Date.now() - started < 1_000);
});

test('VI-02: /predict never waits on the OpenF1 timing sheet and starts its reads together', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../app/predict/page.tsx', import.meta.url), 'utf8');
  // Before: two sequential 8 s OpenF1 reads (loadSheet) only to relabel team names, about 10 s of skeleton.
  assert.doesNotMatch(page, /loadSheet/);
  assert.match(page, /settleWithin\(getGrid\(\)/, 'grid photos are enrichment with a short budget');
  // Schedule, entry list, calendar and grid are read in one Promise.all, not one after another.
  assert.match(page, /Promise\.all\(\[\s*readEntries\(\),\s*getCalendar\(\),\s*settleWithin\(getGrid\(\)/);
});
