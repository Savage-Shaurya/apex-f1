import assert from 'node:assert/strict';
import { test } from 'node:test';
import ArticleSlugLayout from './[slug]/layout';

/**
 * R3-REG-3: an unknown story must be a real 404. The layout runs above the
 * loading boundary, so a notFound() thrown here sets the HTTP status before
 * any streaming starts. With no published story at the slug (no article
 * store configured in tests, which reads as "nothing published"), the
 * layout must throw Next's 404 signal instead of rendering its children.
 */
test('an unknown article slug throws the 404 signal above the loading boundary (R3-REG-3)', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      async () => ArticleSlugLayout({ children: 'story', params: Promise.resolve({ slug: 'no-such-story-r3-reg-3' }) }),
      (error: unknown) => {
        const digest = (error as { digest?: string })?.digest ?? '';
        return /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(digest);
      },
    );
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});
