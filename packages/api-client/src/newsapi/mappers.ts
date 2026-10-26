// Map NewsAPI raw articles → UiNewsItem (the unified news rail shape).
//
// UiNewsItem is the canonical news shape every news provider in @apex/api-client
// normalises to (RSS, Guardian, NewsAPI, NewsData, GNews). The aggregator in
// ../rss/index.ts dedupes + sorts on this shape, so every field a UI surface
// renders must come from here.

import type { NewsAPIArticle } from './types';

/**
 * Unified UI shape for any news source. Mirrors the existing RssItem fields
 * so the aggregator can merge across providers with zero casting.
 */
export interface UiNewsItem {
  /** Display name of the publisher ("BBC Sport", "Motorsport.com", ...). */
  source: string;
  /** Stable provider key for grouping / filtering ("newsapi", "rss", "guardian"). */
  provider: 'newsapi' | 'rss' | 'guardian' | 'newsdata' | 'gnews' | 'currents';
  /** Plain-text headline, HTML stripped. */
  title: string;
  /** Canonical article URL. */
  link: string;
  /** ISO-8601 string as received from the provider. */
  pubDate: string;
  /** Epoch ms for cheap sort. 0 if unparseable. */
  pubDateMs: number;
  /** Short plain-text dek. May be empty. */
  description?: string;
  /** Hero image URL. May be undefined. */
  imageUrl?: string;
  /** Byline. May be undefined. */
  author?: string;
  /** Optional tag list · NewsAPI does not return one, so this is always [] here. */
  categories?: string[];
}

/** Map a single NewsAPI article into the unified UiNewsItem shape. */
export function mapNewsAPIArticleToUi(article: NewsAPIArticle): UiNewsItem {
  const pubDateMs = toMs(article.publishedAt);
  return {
    source: article.source?.name || 'NewsAPI',
    provider: 'newsapi',
    title: stripBoilerplate(article.title, article.source?.name),
    link: article.url,
    pubDate: article.publishedAt,
    pubDateMs,
    description: article.description?.trim() || undefined,
    imageUrl: article.urlToImage ?? undefined,
    author: article.author?.trim() || undefined,
    categories: [],
  };
}

/** Convenience batch mapper. */
export function mapNewsAPIArticlesToUi(
  articles: NewsAPIArticle[],
): UiNewsItem[] {
  return articles.map(mapNewsAPIArticleToUi);
}

/* ------------------------------------------------------------------ */
/* internals                                                          */
/* ------------------------------------------------------------------ */

function toMs(iso: string): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Publishers commonly append " - Publisher Name" to the title field. Strip it
 * when the suffix matches the source we already have on the record.
 */
function stripBoilerplate(title: string, source?: string): string {
  const suffix = title.match(/\s+-\s+([^-]+)$/);
  return suffix && source && suffix[1]?.trim().toLocaleLowerCase() === source.trim().toLocaleLowerCase()
    ? title.slice(0, suffix.index).trim()
    : title.trim();
}
