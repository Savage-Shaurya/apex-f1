import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDb, getDb } from './client';
import { ArticleStorageUnavailable, getArticleBySlug, getPublishedArticles } from './queries';

test('public article lists omit full bodies while detail reads retain publication and entitlement filters', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
  delete process.env.DATABASE_SSL_CA_PATH;
  const client = getDb().$client;
  const originalUnsafe = client.unsafe;
  const statements: { query: string; parameters: unknown[] }[] = [];
  Reflect.set(client, 'unsafe', (query: string, parameters: unknown[] = []) => {
    if (!/^select .* from "article"/.test(query)) throw new Error('Fixture rejects every unrelated statement.');
    statements.push({ query, parameters });
    const result = Promise.resolve([]);
    return Object.assign(result, { values: () => result });
  });
  try {
    assert.deepEqual(await getPublishedArticles(2000), []);
    const list = statements[0]!;
    assert.doesNotMatch(list.query.split(' from ')[0]!, /"body_md"/);
    assert.equal(list.parameters.at(-1), 2000);
    const slug = "fixture' OR true --";
    assert.equal(await getArticleBySlug(slug), null);
    const detail = statements[1]!;
    assert.match(detail.query.split(' from ')[0]!, /"body_md"/);
    assert.equal(detail.query.includes(slug), false);
    assert.equal(detail.parameters.includes(slug), true);
    for (const statement of statements) {
      assert.match(statement.query, /"article"\."published_at" is not null/);
      assert.match(statement.query, /"article"\."published_at" <= now\(\)/);
      assert.match(statement.query, /"article"\."embargo_until" <= now\(\)/);
      assert.match(statement.query, /"article"\."is_premium" = \$/);
      assert.equal(statement.parameters.includes(false), true);
    }
  } finally {
    Reflect.set(client, 'unsafe', originalUnsafe);
    await closeDb();
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
});

test('configured storage failures are unavailable, never missing articles or successful empty lists', async () => {
  const previousUrl = process.env.DATABASE_URL;
  const previousCa = process.env.DATABASE_SSL_CA_PATH;
  try {
    delete process.env.DATABASE_URL;
    assert.equal(await getArticleBySlug('missing'), null);
    assert.deepEqual(await getPublishedArticles(), []);
    process.env.DATABASE_URL = 'postgresql://offline-fixture@audit.invalid/never-connected';
    delete process.env.DATABASE_SSL_CA_PATH;
    const client = getDb().$client;
    const originalUnsafe = client.unsafe;
    Reflect.set(client, 'unsafe', () => { throw new Error('Synthetic driver error containing password=do-not-expose'); });
    const unavailable = (error: unknown) => {
      assert(error instanceof ArticleStorageUnavailable);
      assert.equal(error.message.includes('do-not-expose'), false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      return true;
    };
    try {
      await assert.rejects(getArticleBySlug('missing'), unavailable);
      await assert.rejects(getPublishedArticles(), unavailable);
    } finally {
      Reflect.set(client, 'unsafe', originalUnsafe);
      await closeDb();
    }
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_SSL_CA_PATH; else process.env.DATABASE_SSL_CA_PATH = previousCa;
  }
});
