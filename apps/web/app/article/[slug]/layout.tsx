import { notFound } from 'next/navigation';
import { ArticleStorageUnavailable } from '@apex/db';
import { getRequestArticleBySlug } from '@/lib/article-read';

/**
 * Resolves the slug above the loading boundary (like app/results/[season]),
 * so an unknown /article/<slug> answers HTTP 404 instead of a streamed 200
 * "not found" page (R3-REG-3). Storage being unavailable is not "missing":
 * the page renders its honest unavailable state. The read is the same
 * request-cached call the page and metadata use, so it costs no extra query.
 */
export default async function ArticleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let missing = false;
  try { missing = (await getRequestArticleBySlug(slug)) === null; }
  catch (error) { if (!(error instanceof ArticleStorageUnavailable)) throw error; }
  if (missing) notFound();
  return children;
}
