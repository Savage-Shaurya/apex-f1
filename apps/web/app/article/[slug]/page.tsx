import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArticleStorageUnavailable } from '@apex/db';
import { getRequestArticleBySlug } from '@/lib/article-read';
import { ArticleView } from '@/components/news/ArticleView';
import { ArticleEmptyState } from '@/components/news/ArticleEmptyState';
import { readOriginals, readWireStories } from '@/components/news/wire-data';
import { withSocial } from '@/lib/page-metadata';

// Every request checks current publication, embargo and premium eligibility.
export const dynamic = 'force-dynamic';

async function readArticle(slug: string) {
  try {
    return { article: await getRequestArticleBySlug(slug), unavailable: false };
  } catch (error) {
    if (error instanceof ArticleStorageUnavailable) return { article: null, unavailable: true };
    throw error;
  }
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const { article: a, unavailable } = await readArticle(slug);
  if (unavailable) {
    return withSocial({ title: 'Story unavailable', description: 'This story is temporarily unavailable. Please try again shortly.', robots: { index: false, follow: false } });
  }
  // notFound() (layout.tsx) already injects noindex; a second robots tag here duplicated it (R3-REG-3).
  if (!a) return withSocial({ title: 'Story not found' });
  const description = a.dek ?? a.excerpt ?? undefined;
  const canonical = `/article/${a.slug}`;
  return withSocial({
    title: a.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      url: canonical,
      title: a.title,
      description,
      publishedTime: a.publishedAt ? new Date(a.publishedAt).toISOString() : undefined,
      modifiedTime: a.updatedAt ? new Date(a.updatedAt).toISOString() : undefined,
      section: a.section ?? undefined,
      // The story's own photograph when it has one; otherwise the `images` key stays absent so the
      // headline card (./opengraph-image.tsx) is used (an `images: undefined` key suppressed it: F-04).
      ...(a.heroImageUrl ? { images: [a.heroImageUrl] } : {}),
    },
    twitter: { card: 'summary_large_image', title: a.title, description },
  });
}

export default async function ArticlePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const { article, unavailable } = await readArticle(slug);
  if (unavailable) {
    const wire = await readWireStories(6);
    return <ArticleEmptyState reason="storage-unavailable" originals={[]} wire={wire} />;
  }
  if (!article) notFound();
  // Related reading: other Originals first, then the wire. Both degrade to nothing.
  const [originals, wire] = await Promise.all([readOriginals(4), readWireStories(5)]);
  const moreOriginals = originals.articles.filter((o) => o.slug !== article.slug).slice(0, 2);
  return <ArticleView a={article} moreOriginals={moreOriginals} wire={wire} />;
}
