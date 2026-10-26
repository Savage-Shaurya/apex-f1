import { ArticleEmptyState } from '@/components/news/ArticleEmptyState';
import { readOriginals, readWireStories } from '@/components/news/wire-data';

/** Unknown /article/<slug>: say whether any Originals exist, then offer real reading. */
export default async function ArticleNotFound() {
  const [originals, wire] = await Promise.all([readOriginals(3), readWireStories(6)]);
  const reason = originals.unavailable ? 'storage-unavailable' : originals.articles.length ? 'not-found' : 'none-published';
  return <ArticleEmptyState reason={reason} originals={originals.articles} wire={wire} />;
}
