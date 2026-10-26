// Map raw NewsData.io articles → UiNewsItem (the canonical unified news shape
// defined in ../newsapi/mappers.ts) PLUS a UiNewsItemExtended that surfaces
// NewsData's unique sentiment + language payload, so /latest can render the
// sentiment badge and language pill without losing type-safety.

import type { UiNewsItem } from '../newsapi/mappers';
import type {
  NewsDataArticleRaw,
  NewsDataSentiment,
  NewsDataLanguageIso,
} from './types';
import { NEWSDATA_LANG_FROM_LABEL } from './types';

/**
 * Extended news item with NewsData-only fields surfaced. Other providers
 * leave these undefined or null; the UI shows the sentiment badge / language
 * pill only when the values are present.
 */
export interface UiNewsItemExtended extends UiNewsItem {
  /** Hard pin provider to 'newsdata' on this branch. */
  provider: 'newsdata';
  /** Sentiment label from NewsData (or null if absent / free-tier). */
  sentiment: NewsDataSentiment | null;
  /** Confidence breakdown when the publisher tier exposes it. */
  sentimentStats?: { positive: number; neutral: number; negative: number } | null;
  /** ISO 639-1 language code, or null when we couldn't map it. */
  language: NewsDataLanguageIso | null;
  /** Two-letter country codes the article was tagged with, lowercase. */
  countries?: string[];
  /** Stable article id from NewsData, useful for dedup keys. */
  articleId?: string;
}

/**
 * Convert NewsData's "YYYY-MM-DD HH:MM:SS" (UTC, no Z) into a real ISO string.
 * Returns 0 / '' if the date is unparseable.
 */
function parsePubDate(raw: string | undefined | null): { iso: string; ms: number } {
  if (!raw) return { iso: '', ms: 0 };
  // NewsData omits the Z but documents the value as UTC.
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const ms = new Date(normalized).getTime();
  if (!Number.isFinite(ms)) return { iso: '', ms: 0 };
  return { iso: new Date(ms).toISOString(), ms };
}

function languageFromLabel(label: string): NewsDataLanguageIso | null {
  const key = label.toLowerCase().trim();
  return NEWSDATA_LANG_FROM_LABEL[key] ?? null;
}

function pickSourceName(a: NewsDataArticleRaw): string {
  // source_name is the human label; source_id is the slug. Prefer the label.
  if (a.source_name && a.source_name.trim().length > 0) return a.source_name;
  if (a.source_id && a.source_id.trim().length > 0) {
    return a.source_id.charAt(0).toUpperCase() + a.source_id.slice(1);
  }
  return 'NewsData';
}

function pickAuthor(creator: string[] | null | undefined): string | undefined {
  if (!creator || creator.length === 0) return undefined;
  const first = creator[0];
  if (!first) return undefined;
  if (first.toLowerCase() === 'unknown') return undefined;
  return first;
}

/** Map a single raw NewsData article to the extended UI shape. */
export function mapNewsDataArticle(a: NewsDataArticleRaw): UiNewsItemExtended {
  const { iso, ms } = parsePubDate(a.pubDate);
  return {
    provider: 'newsdata',
    source: pickSourceName(a),
    title: a.title,
    link: a.link,
    pubDate: iso,
    pubDateMs: ms,
    description: a.description ?? undefined,
    imageUrl: a.image_url ?? undefined,
    author: pickAuthor(a.creator),
    categories: a.category,
    sentiment: a.sentiment ?? null,
    sentimentStats: a.sentiment_stats ?? null,
    language: languageFromLabel(a.language),
    countries: a.country,
    articleId: a.article_id,
  };
}

/** Map a list, drop entries with no title or link (NewsData occasionally ships empty rows). */
export function mapNewsDataArticles(items: NewsDataArticleRaw[]): UiNewsItemExtended[] {
  return items
    .map(mapNewsDataArticle)
    .filter((i) => i.title && i.link);
}
