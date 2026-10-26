// Map GNews raw articles -> UiNewsItem.
//
// UiNewsItem is a structural alias of RssItem (the canonical news shape in
// `@apex/api-client/rss`) so GNews results slot straight into the existing
// aggregator pipeline without needing a second discriminated type. This
// mirrors how `@apex/api-client/guardian` handles it.

import type { RssItem } from '../rss';
import type { GNewsArticle } from './types';
import { GNEWS_FREE_TIER_DELAY_MS } from './types';

/**
 * Canonical news shape used by every news rail on the platform.
 * Alias re-exported here for caller ergonomics.
 */
export type UiNewsItem = RssItem;

/**
 * Banner string we attach to the `description` field when a GNews item is
 * delivered without a description of its own. Keeps the /latest cards from
 * rendering empty bodies, and gives users a one-line reminder that GNews
 * free-tier content is delayed.
 */
const FREE_TIER_DELAY_NOTE = 'GNews free tier - article surfaced 12h+ after publication.';

/** Parse an ISO-8601 timestamp, returning 0 on failure so sort stays stable. */
function toMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Map a single GNews article to UiNewsItem (= RssItem).
 *
 * The 12-hour delay is a platform-wide property of GNews's free tier, not
 * a per-article flag, so we don't try to encode it in the type system - we
 * just append a short note to the description when one would otherwise be
 * absent, and rely on the source label ("GNews · {publisher}") to cue the
 * reader. The /latest page's source pill marks the whole feed as DELAYED.
 */
export function mapGNewsArticle(a: GNewsArticle): UiNewsItem {
  const publisherName = a.source?.name?.trim() || 'GNews';
  const baseDescription = (a.description ?? '').trim();
  return {
    // Prefix the publisher with GNews so per-source filtering by name on
    // /latest renders the right pill even when multiple GNews articles
    // come from different publishers (BBC, Reuters, etc.).
    source: `GNews · ${publisherName}`,
    title: a.title,
    link: a.url,
    pubDate: a.publishedAt,
    pubDateMs: toMs(a.publishedAt),
    description: baseDescription.length > 0 ? baseDescription : FREE_TIER_DELAY_NOTE,
    imageUrl: a.image ?? undefined,
    author: undefined,
    categories: ['gnews'],
  };
}

/**
 * Map and filter a batch of GNews articles.
 *
 * Defaults:
 *  - Drops anything older than 7 days (free-tier delay accounted for).
 *  - Drops anything missing a title or url.
 *  - Sorts newest-first by publishedAt.
 */
export function mapGNewsArticles(
  articles: GNewsArticle[],
  opts: { maxAgeMs?: number } = {},
): UiNewsItem[] {
  const maxAgeMs = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  // The cutoff lives "before" the delay - i.e. an article published 7 days
  // ago is fine even though we only saw it 6.5 days ago.
  const cutoff = Date.now() - (maxAgeMs + GNEWS_FREE_TIER_DELAY_MS);
  return articles
    .map(mapGNewsArticle)
    .filter((i) => i.title && i.link && i.pubDateMs >= cutoff)
    .sort((a, b) => b.pubDateMs - a.pubDateMs);
}
