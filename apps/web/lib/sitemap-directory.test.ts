import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { readSitemapDirectories, SitemapIncompleteError } from './sitemap-directory';

const ok = { getAllDrivers: async () => [], getAllConstructors: async () => [], getSchedule: async () => [], getSeasons: async () => [], getAllRaceWinners: async () => [] };

test('D2-RESILIENCE-1: a failed directory read fails the sitemap render instead of returning a short list', async () => {
  const strictSeen: boolean[] = [];
  const provider = {
    ...ok,
    getAllDrivers: async (opts?: { strict?: boolean }) => { strictSeen.push(Boolean(opts?.strict)); throw new ProviderError('jolpica', 'http', 503); },
  } as never;
  await assert.rejects(readSitemapDirectories(provider, { allowPartial: false }), (error) => error instanceof SitemapIncompleteError && error.failed.includes('drivers'));
  assert.deepEqual(strictSeen, [true]);
  const partial = await readSitemapDirectories(provider, { allowPartial: true });
  assert.equal(partial.drivers.status, 'rejected');
  const healthy = await readSitemapDirectories(ok as never, { allowPartial: false });
  assert.equal(healthy.seasons.status, 'fulfilled');
});

test('R3-REG-6 / R3-CODE-3: a failed race-history read fails the sitemap instead of silently dropping every race page', async () => {
  const strictSeen: boolean[] = [];
  const provider = {
    ...ok,
    getAllRaceWinners: async (opts?: { strict?: boolean }) => { strictSeen.push(Boolean(opts?.strict)); throw new ProviderError('jolpica', 'timeout'); },
  } as never;
  await assert.rejects(readSitemapDirectories(provider, { allowPartial: false }), (error) => error instanceof SitemapIncompleteError && error.failed.includes('history'));
  assert.deepEqual(strictSeen, [true]);
  const healthy = await readSitemapDirectories(ok as never, { allowPartial: false });
  assert.equal(healthy.history.status, 'fulfilled');
});
