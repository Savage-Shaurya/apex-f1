import assert from 'node:assert/strict';
import { test } from 'node:test';
import ArticleLayout from '../app/article/[slug]/layout';
import { generateMetadata } from '../app/article/[slug]/page';

test('R3-REG-3: an unknown article slug calls notFound() above the loading boundary', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL; // storage unset: every slug is a confirmed miss
  try {
    await assert.rejects(
      ArticleLayout({ children: null, params: Promise.resolve({ slug: 'nope' }) }),
      (error: { digest?: string }) => typeof error.digest === 'string' && error.digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404'),
    );
    // Metadata for the miss adds no robots entry of its own (notFound injects one noindex).
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: 'nope' }) });
    assert.equal(metadata.robots, undefined);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});
