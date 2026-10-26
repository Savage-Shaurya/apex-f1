import { getAggregatedF1News } from '@apex/api-client';
import { ArticleStorageUnavailable, getPublishedArticles, type ApexArticleSummary } from '@apex/db';
import type { WireStory } from './WireStories';
import { cleanHeadline, cleanSummary, collapseSyndicated } from './news-format';

/**
 * The newest F1-only wire stories (news policy applied), with syndicated
 * copies folded into one story, or [] when every provider is down.
 */
export async function readWireStories(count: number): Promise<WireStory[]> {
  const items = await getAggregatedF1News({ limit: Math.max(count * 3, 24), revalidate: 300 }).catch(() => []);
  const stories = items.map((it) => ({
    title: cleanHeadline(it.title, it.source),
    href: it.link,
    source: it.source,
    publishedMs: it.pubDateMs,
    summary: cleanSummary(it.description) || undefined,
    imageUrl: it.imageUrl ?? null,
  }));
  return collapseSyndicated(stories).slice(0, count);
}

/** Published Apex Originals, with the store's own failure kept distinct from "none published". */
export async function readOriginals(limit: number): Promise<{ articles: ApexArticleSummary[]; unavailable: boolean }> {
  try {
    return { articles: await getPublishedArticles(limit), unavailable: false };
  } catch (error) {
    if (error instanceof ArticleStorageUnavailable) return { articles: [], unavailable: true };
    throw error;
  }
}
