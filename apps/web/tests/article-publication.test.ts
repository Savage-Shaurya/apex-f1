import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorialConflict, type EditorialPublication } from '@apex/db';
import { InputError } from '../lib/api-input';
import { parseEditorialPublication, saveEditorialPublication } from '../lib/article-publication';

const id = '10000000-0000-4000-8000-000000000001';
const revision = '2026-10-03 12:13:14.123456+00';
const publication: EditorialPublication = { id, slug: 'policy-report', title: 'Policy report', section: null, status: 'draft', visibility: 'restricted', editable: false, publishedAt: null, embargoUntil: null, isPremium: true, revision };
test('publication policy accepts explicit null/boolean/timezone fields and rejects ambiguous or unsupported intent', () => {
  assert.deepEqual(parseEditorialPublication({ id, revision, publishedAt: '2030-01-01T12:13:14.123456Z', embargoUntil: null, isPremium: false }).patch, { publishedAt: '2030-01-01T12:13:14.123456Z', embargoUntil: null, isPremium: false });
  for (const patch of [{}, { publishedAt: '2030-01-01' }, { publishedAt: '2026-02-30T12:00:00Z' }, { publishedAt: '2030-01-01T24:00:00Z' }, { embargoUntil: '2030-01-01T12:00:00' }, { embargoUntil: false }, { isPremium: 'false' }, { isPremium: null }, { title: 'Unrequested content change' }, { status: 'published' }]) assert.throws(() => parseEditorialPublication({ id, revision, ...patch }), InputError);
});
test('confirmed policy refreshes every related route and retains confirmation if one refresh fails', async () => {
  const calls: unknown[] = [];
  const result = await saveEditorialPublication({ id, revision, isPremium: true }, { update: async (...args) => { calls.push(args); return publication; }, refresh: (path) => { calls.push(path); if (path === '/') throw new Error('cache failed'); } });
  assert.equal(result.status, 200);
  const body = await result.json(); assert.equal(body.ok, true); assert.equal(body.publication.isPremium, true); assert.equal(body.refreshPending, true);
  assert.deepEqual(calls[0], [id, revision, { isPremium: true }]); assert(calls.includes('/sitemap-index.xml')); assert(calls.includes('/article/[slug]'));
});
test('policy stale/missing and uncertain storage outcomes do not refresh or expose private errors', async () => {
  for (const [error, status] of [[new EditorialConflict('Changed policy', 409), 409], [new EditorialConflict('Missing article', 404), 404], [new Error('postgresql://private:password@hidden/db'), 503]] as const) {
    let refreshes = 0;
    const result = await saveEditorialPublication({ id, revision, publishedAt: null }, { update: async () => { throw error; }, refresh: () => { refreshes++; } });
    assert.equal(result.status, status); assert.equal(refreshes, 0);
    const body = await result.json(); assert.equal(body.writeUncertain, status === 503 ? true : undefined); assert.equal(JSON.stringify(body).includes('hidden'), false);
  }
});
