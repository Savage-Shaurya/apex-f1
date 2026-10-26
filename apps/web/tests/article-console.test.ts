import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { EditorialConflict, isEditorialRevision, type EditorialArticle } from '@apex/db';
import { GET, PATCH, POST } from '../app/api/articles/route';
import { PATCH as patchPublication } from '../app/api/articles/publication/route';
import { GET as getAudit } from '../app/api/articles/audit/route';
import { hashAdminPassword } from '../lib/admin-auth';
import { InputError } from '../lib/api-input';
import { encodeEditorialCursor, parseEditorialCursor, parseEditorialIdentity, parseEditorialInput, saveEditorialArticle, type EditorialMutationServices } from '../lib/article-console';

const id = '10000000-0000-4000-8000-000000000001';
const revision = '2026-10-03 12:13:14.123456+00';
const body = { title: 'Apex analysis', slug: 'apex-analysis', bodyMd: '## Strategy\n\nVerified reporting.', section: 'ANALYSIS', dek: 'Race review', status: 'draft' };
const article: EditorialArticle = { ...body, id, revision, status: 'draft', visibility: 'draft', editable: true, publishedAt: null };
const keys = ['NODE_ENV', 'ADMIN_PASSWORD', 'ADMIN_USERS_JSON', 'ADMIN_LOCAL_DEV_BYPASS', 'DATABASE_URL', 'VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'DISTRIBUTED_RATE_LIMIT_REQUIRED'] as const;
const originals = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
beforeEach(() => { for (const key of keys) delete process.env[key]; Object.assign(process.env, { NODE_ENV: 'test' }); globalThis.fetch = async () => { throw new Error('Unexpected external request'); }; });
afterEach(() => {
  for (const key of keys) { if (originals[key] === undefined) delete process.env[key]; else Object.assign(process.env, { [key]: originals[key] }); }
  globalThis.fetch = originalFetch;
});
function request(method: string, payload?: unknown, authorized = false, origin = 'https://apex.example'): Request {
  return new Request('https://apex.example/api/articles', { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(authorized ? { Authorization: `Basic ${btoa('apex:synthetic-admin')}` } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
function services(overrides: Partial<EditorialMutationServices> = {}): EditorialMutationServices {
  return { create: async () => article, update: async () => article, refresh: () => {}, ...overrides };
}
function sharedQuotaFixture() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://synthetic.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic-token';
  globalThis.fetch = async (url) => { assert.equal(String(url), 'https://synthetic.upstash.io'); return Response.json({ result: [1, 60_000] }); };
}
function namedRequest(method: string, payload?: unknown) {
  const req = request(method, payload);
  req.headers.set('Authorization', `Basic ${btoa('apex:synthetic-admin-fixture')}`);
  return req;
}

test('CMS list and both writes reject direct requests without handler authorization', async () => {
  process.env.ADMIN_PASSWORD = 'synthetic-admin';
  sharedQuotaFixture();
  for (const handler of [GET, POST, PATCH]) {
    const result = await handler(request(handler === GET ? 'GET' : handler === POST ? 'POST' : 'PATCH', handler === GET ? undefined : body));
    assert.equal(result.status, 401);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  }
});
test('CMS missing database and deployed quota fail closed without an external persistence attempt', async () => {
  process.env.ADMIN_PASSWORD = 'synthetic-admin';
  assert.equal((await GET(request('GET', undefined, true))).status, 503);
  assert.equal((await POST(request('POST', body, true))).status, 503);
  process.env.DATABASE_URL = 'not-a-url';
  assert.equal((await GET(request('GET', undefined, true))).status, 503);
  assert.equal((await PATCH(request('PATCH', { ...body, id, revision }, true))).status, 503);
});
test('CMS foreign browser writes are rejected before reading or persisting their body', async () => {
  process.env.ADMIN_PASSWORD = 'synthetic-admin';
  sharedQuotaFixture();
  assert.equal((await POST(request('POST', body, true, 'https://foreign.example'))).status, 403);
  assert.equal((await PATCH(request('PATCH', body, true, 'https://foreign.example'))).status, 403);
});
test('named read-only administrators cannot mutate content or policy, while audit reads still validate their bounded identity', async () => {
  sharedQuotaFixture();
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'apex', passwordHash: await hashAdminPassword('synthetic-admin-fixture'), capabilities: ['read'] }]);
  for (const handler of [POST, PATCH, patchPublication]) assert.equal((await handler(namedRequest('POST', body))).status, 403);
  assert.equal((await getAudit(namedRequest('GET'))).status, 400);
});
test('named draft writers cannot publish through either API even if they request published status', async () => {
  sharedQuotaFixture();
  process.env.DATABASE_URL = 'invalid-fixture-never-connected';
  process.env.ADMIN_USERS_JSON = JSON.stringify([{ username: 'apex', passwordHash: await hashAdminPassword('synthetic-admin-fixture'), capabilities: ['read', 'write'] }]);
  assert.equal((await POST(namedRequest('POST', { ...body, status: 'published' }))).status, 403);
  assert.equal((await patchPublication(namedRequest('PATCH', { id, revision, isPremium: false }))).status, 403);
});

test('draft-only writers cannot publish, change public reporting or unpublish it through the basic editor', async () => {
  let writes = 0;
  const draftOnly = services({ canPublish: false, load: async () => ({ ...article, status: 'published', visibility: 'public' }), create: async () => { writes++; return article; }, update: async () => { writes++; return article; } });
  for (const [method, payload] of [['POST', { ...body, status: 'published' }], ['PATCH', { ...body, id, revision, status: 'published' }], ['PATCH', { ...body, id, revision, status: 'draft' }]] as const) assert.equal((await saveEditorialArticle(method, payload, draftOnly)).status, 403);
  assert.equal(writes, 0);
  assert.equal((await saveEditorialArticle('POST', body, draftOnly)).status, 200);
  assert.equal((await saveEditorialArticle('PATCH', { ...body, id, revision }, { ...draftOnly, load: async () => article })).status, 200);
  assert.equal(writes, 2);
});
test('failed publication permission reads do not attempt a save or fabricate an uncertain commit', async () => {
  let writes = 0;
  const result = await saveEditorialArticle('PATCH', { ...body, id, revision }, services({ canPublish: false, load: async () => { throw new Error('Read outage'); }, update: async () => { writes++; return article; } }));
  assert.equal(result.status, 503); assert.equal(writes, 0); assert.equal((await result.json()).writeUncertain, undefined);
});
test('CMS parses only supported bounded fields and preserves microsecond revision tokens', () => {
  const parsed = parseEditorialInput({ ...body, title: '  Title  ', bodyMd: ' Body ', isPremium: true, publishedAt: '2099-01-01' });
  assert.equal(parsed.title, 'Title'); assert.equal(parsed.bodyMd, 'Body');
  assert.equal('isPremium' in parsed, false); assert.equal('publishedAt' in parsed, false);
  assert.deepEqual(parseEditorialIdentity({ id, revision }), { id, revision });
  assert.equal(isEditorialRevision(revision), true);
  assert.equal(isEditorialRevision('2026-02-30 12:13:14.123456+00'), false);
  assert.equal(isEditorialRevision('2024-02-29 12:13:14.123456+00'), true);
  assert.throws(() => parseEditorialIdentity({ id, revision: 'x' }), InputError);
  assert.throws(() => parseEditorialIdentity({ id: 'not-an-id', revision }), InputError);
  for (const invalid of [{ ...body, title: '' }, { ...body, slug: '../../admin' }, { ...body, bodyMd: 'x'.repeat(100_001) }, { ...body, status: 'queued' }, { ...body, section: [] }]) assert.throws(() => parseEditorialInput(invalid), InputError);
});
test('CMS keyset cursor round-trips identity and full precision; malformed and oversized cursors fail', () => {
  assert.deepEqual(parseEditorialCursor(encodeEditorialCursor({ id, revision })), { id, revision });
  assert.equal(parseEditorialCursor(null), undefined);
  for (const cursor of ['!', 'x'.repeat(257), Buffer.from(JSON.stringify({ id, revision: 'bad' })).toString('base64url'), Buffer.from('[]').toString('base64url')]) assert.throws(() => parseEditorialCursor(cursor), InputError);
});
test('draft confirmation is returned with its stored revision; PATCH updates the existing identity', async () => {
  const calls: unknown[] = [];
  const store = services({ create: async (input) => { calls.push(['create', input.status]); return article; }, update: async (actualId, actualRevision, input) => { calls.push(['update', actualId, actualRevision, input.status]); return { ...article, status: 'published', visibility: 'public', publishedAt: '2026-10-03 12:14:00+00', revision: '2026-10-03 12:14:00.654321+00' }; } });
  const created = await saveEditorialArticle('POST', body, store);
  assert.equal((await created.json()).article.revision, revision);
  const published = await saveEditorialArticle('PATCH', { ...body, id, revision, status: 'published' }, store);
  const result = await published.json();
  assert.equal(result.article.id, id); assert.equal(result.article.visibility, 'public'); assert.equal(result.article.revision, '2026-10-03 12:14:00.654321+00');
  assert.deepEqual(calls, [['create', 'draft'], ['update', id, revision, 'published']]);
});
test('CMS storage confirmation survives one failed cache refresh and every other path is attempted', async () => {
  let creates = 0;
  const refreshed: [string, string | undefined][] = [];
  const response = await saveEditorialArticle('POST', body, services({ create: async () => { creates++; return article; }, refresh: (path, type) => { refreshed.push([path, type]); if (path === '/latest') throw new Error('cache unavailable'); } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).refreshPending, true); assert.equal(creates, 1);
  assert.deepEqual(refreshed, [['/latest', undefined], ['/', undefined], ['/search', undefined], ['/sitemap.xml', undefined], ['/sitemap-index.xml', undefined], ['/article/[slug]', 'page']]);
});
test('CMS stale revision, missing article and unavailable storage stay distinct and never refresh caches', async () => {
  for (const [error, expected] of [[new EditorialConflict('This article changed after you opened it.', 409), 409], [new EditorialConflict('This article no longer exists.', 404), 404], [new Error('postgresql://private-user:secret@private-host/database'), 503]] as const) {
    let refreshes = 0;
    const result = await saveEditorialArticle('PATCH', { ...body, id, revision }, services({ update: async () => { throw error; }, refresh: () => { refreshes++; } }));
    assert.equal(result.status, expected); assert.equal(refreshes, 0); assert.equal(JSON.stringify(await result.json()).includes('private-host'), false);
  }
});
test('CMS duplicate insert is a conflict, with no fallback that can overwrite another article', async () => {
  let updates = 0;
  const response = await saveEditorialArticle('POST', body, services({ create: async () => { throw new Error('insert failed', { cause: { code: '23505' } }); }, update: async () => { updates++; return article; } }));
  assert.equal(response.status, 409); assert.equal(updates, 0);
});
test('CMS updates require explicit publication status and retries retain a stable creation identity', async () => {
  const withoutStatus: Record<string, unknown> = { ...body };
  delete withoutStatus.status;
  let createdId: string | undefined;
  await assert.rejects(saveEditorialArticle('PATCH', { ...withoutStatus, id, revision }, services()), /Publication status is required/);
  const response = await saveEditorialArticle('POST', { ...body, id }, services({ create: async (_input, actualId) => { createdId = actualId; return article; } }));
  assert.equal(response.status, 200); assert.equal(createdId, id);
  const unavailable = await saveEditorialArticle('POST', { ...body, id }, services({ create: async () => { throw new Error('acknowledgement lost'); } }));
  assert.equal((await unavailable.json()).writeUncertain, true);
});
