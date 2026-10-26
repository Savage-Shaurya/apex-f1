// GNews.io typed client.
//
// =========================================================================
// FREE-TIER CONSTRAINTS - read before tuning anything in this file
// =========================================================================
//
// 1) RATE LIMIT: 100 requests / 24h. The 1200s cache floor corresponds to
//    72 refreshes/day for one cache key. Query variants, regions and workers
//    still share the account quota; this floor is not a distributed quota cap.
//    The aggregator must NOT call this client
//    from a hot-path; it must call it from an ISR-cached server component.
//
// 2) ARTICLE DELAY: free-tier articles surface ~12 HOURS AFTER PUBLICATION.
//    GNews intentionally throttles the free feed so paying customers get the
//    real-time signal. Do not market GNews stories as "breaking" · they are
//    not. Useful for: deep archive sweeps, multi-source corroboration,
//    non-English coverage (lang param), and filling gaps when our RSS feeds
//    miss a story. NOT useful for: live race weekends, breaking news rails,
//    "minutes-ago" timestamps.
//
// 3) MAX 10 ARTICLES per request on the free tier. We cap `pageSize` at 10
//    and silently truncate larger requests rather than 400-ing.
//
// 4) QUOTA EXHAUSTION: when the daily quota is hit GNews returns 403 with
//    `errors: ["You have reached your daily quota..."]`. We catch this and
//    return [] so the calling UI gracefully shows "no items" instead of
//    crashing the server render.
//
// 5) NO API KEY: when GNEWS_API_KEY is unset we return [] immediately and
//    do not hit the network. Matches the project's "no mock data" rule.
//
// =========================================================================

import {
  GNEWS_BASE,
  GNEWS_FREE_TIER_MAX_PER_REQUEST,
  isGNewsError,
  type GNewsArticle,
  type GNewsCountry,
  type GNewsLang,
  type GNewsResponse,
  type GNewsSortBy,
} from './types';
import { ProviderError, failOr, isRecord, requestJson, type ProviderRequestOptions } from '../transport';
import { NEWS_CACHE_TAG } from '../cache-tags';

/** Caller-facing options. */
export interface GetGNewsF1NewsOptions extends ProviderRequestOptions {
  strict?: boolean;
  /** How many articles to ask for. Free tier hard-caps at 10. */
  pageSize?: number;
  /** Language filter. Default `'en'`. */
  lang?: GNewsLang;
  /** Country filter. `'any'` (default) omits the param. */
  country?: GNewsCountry;
  /** Sort order. Default `'publishedAt'` (newest-first). */
  sortby?: GNewsSortBy;
  /** Search query override. Default `'Formula 1'`. */
  q?: string;
  /** Next.js ISR revalidate seconds. Default/floor 1200. */
  revalidate?: number;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
}

/** Minimum allowed `revalidate` · protects the 100-req/day quota. */
const MIN_REVALIDATE_SECONDS = 1200;

/** Default `revalidate` if caller doesn't specify. */
const DEFAULT_REVALIDATE_SECONDS = 1200;

/**
 * Fetch F1 news from GNews.io.
 *
 * Returns [] by default, or throws with strict:true, on:
 *  - missing GNEWS_API_KEY
 *  - non-2xx response (incl. 403 quota-exceeded)
 *  - network error / abort
 *  - malformed JSON / unexpected payload shape
 *
 * Always remember the 12-hour delay (see file header).
 */
export async function getGNewsF1News(
  opts: GetGNewsF1NewsOptions = {},
): Promise<GNewsArticle[]> {
  const apiKey = process.env['GNEWS_API_KEY'];
  if (!apiKey) {
    // No key -> behave as if the source is disabled. Matches project rule:
    // "If a key is missing, return [] and the calling UI shows empty state."
    return failOr('gnews', new ProviderError('gnews', 'configuration'), opts.strict, []);
  }

  const {
    pageSize = GNEWS_FREE_TIER_MAX_PER_REQUEST,
    lang = 'en',
    country = 'any',
    sortby = 'publishedAt',
    q = 'Formula 1',
    revalidate = DEFAULT_REVALIDATE_SECONDS,
    fetchImpl = fetch,
  } = opts;

  // Clamp pageSize to free-tier ceiling.
  const max = Math.max(1, Math.min(pageSize, GNEWS_FREE_TIER_MAX_PER_REQUEST));

  // Clamp revalidate floor. Caller can still set higher, but never lower.
  const safeRevalidate = Math.max(revalidate, MIN_REVALIDATE_SECONDS);

  const url = new URL(`${GNEWS_BASE}/search`);
  url.searchParams.set('q', q);
  url.searchParams.set('lang', lang);
  if (country !== 'any') url.searchParams.set('country', country);
  url.searchParams.set('max', String(max));
  url.searchParams.set('sortby', sortby);
  url.searchParams.set('apikey', apiKey);

  try {
    const json = await requestJson<GNewsResponse>('gnews', url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: safeRevalidate, tags: [NEWS_CACHE_TAG, 'news:gnews'] },
    } as RequestInit, { ...opts, fetchImpl });
    if (!json || isGNewsError(json) || !Array.isArray(json.articles) || json.articles.some(article =>
      !isRecord(article) || typeof article.title !== 'string' || typeof article.url !== 'string' || typeof article.publishedAt !== 'string' ||
      !isRecord(article.source) || typeof article.source.name !== 'string' ||
      ['description','content','image'].some(key => article[key] != null && typeof article[key] !== 'string')
    )) throw new ProviderError('gnews', 'invalid-response');

    // Defensive: GNews has been seen returning `articles: null` on degraded
    // days. Coerce to []. Also strip any entry missing the required fields.
    const list = Array.isArray(json.articles) ? json.articles : [];
    return list.filter(
      (a): a is GNewsArticle =>
        !!a &&
        typeof a.title === 'string' &&
        typeof a.url === 'string' &&
        typeof a.publishedAt === 'string' &&
        a.title.length > 0 &&
        a.url.length > 0,
    );
  } catch (error) {
    return failOr('gnews', error, opts.strict, []);
  }
}
