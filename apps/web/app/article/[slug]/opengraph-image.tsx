import { ArticleStorageUnavailable } from '@apex/db';
import { getRequestArticleBySlug } from '@/lib/article-read';
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard, type OgCardData } from '@/lib/og/card';

// Share image (final audit F-04) for a story without its own photograph: its headline and standfirst.
// Read through the same publication and embargo checks as the page, on every request.
export const alt = 'Apex story card: the headline and standfirst';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = 'force-dynamic';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let card: OgCardData = { kicker: 'Apex', title: 'Formula 1 story', tone: 'headline' };
  try {
    const a = await getRequestArticleBySlug(slug);
    if (a) card = { kicker: ['Apex Original', a.section].filter(Boolean).join(' · '), title: a.title, subtitle: a.dek ?? null, tone: 'headline' };
  } catch (error) {
    if (!(error instanceof ArticleStorageUnavailable)) throw error;
  }
  return renderOgCard(card, { cacheControl: 'public, max-age=300, s-maxage=300' });
}
