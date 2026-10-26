// NewsAPI.org typed client for the F1 news rail.
//
// NewsAPI's developer plan is for development/testing, not production use.
// Moving the request to a server does not grant a production license. Keys
// belong only on the server; invoke this module from
// from:
//   - Next.js Route Handlers              (app/api/.../route.ts)
//   - Server Components                   (default in app/)
//   - Server Actions                      ("use server")
//   - Background jobs / workers           (apps/workers/*)
//
// Never import this module into a client component.
//
// Quota: 100 requests / 24h on the dev plan. We cache aggressively (default
// 1000s floor) via Next.js fetch revalidate. Distinct queries, regions, cache
// eviction and worker processes share the account quota; this is no global cap.

import {
  NEWSAPI_F1_QUERY,
  type GetNewsAPIF1NewsOptions,
  type NewsAPIArticle,
  type NewsAPIEverythingResponse,
} from './types';
import { ProviderError, failOr, isRecord, requestJson } from '../transport';
import { NEWS_CACHE_TAG } from '../cache-tags';
import { APEX_USER_AGENT } from '../user-agent';

const NEWSAPI_ENDPOINT = 'https://newsapi.org/v2/everything';
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_REVALIDATE_SECONDS = 1000;
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Fetch the latest F1-relevant articles from NewsAPI.org /v2/everything.
 *
 * Returns `[]` by default, or throws a redacted ProviderError with strict:true, when:
 *   - NEWSAPI_KEY env var is missing
 *   - NewsAPI responds 429 (daily quota burned)
 *   - NewsAPI responds 5xx
 *   - Network / abort / JSON parse error
 *   - status: "error" envelope (corsNotAllowed, apiKeyInvalid, etc.)
 *
 * Filters out NewsAPI's "[Removed]" placeholder articles before returning.
 */
export async function getNewsAPIF1News(
  opts: GetNewsAPIF1NewsOptions = {},
): Promise<NewsAPIArticle[]> {
  const apiKey = process.env['NEWSAPI_KEY'];
  if (!apiKey) {
    // No key provisioned. Per repo rule #1 (NO mock data), return empty -
    // the calling UI is expected to render an empty / loading state.
    return failOr('newsapi', new ProviderError('newsapi', 'configuration'), opts.strict, []);
  }

  const pageSize = clampPageSize(opts.pageSize ?? DEFAULT_PAGE_SIZE);
  const revalidate = Math.max(1000, opts.revalidate ?? DEFAULT_REVALIDATE_SECONDS);

  const url = buildEverythingUrl({ query: NEWSAPI_F1_QUERY, pageSize });

  try {
    const json = await requestJson<NewsAPIEverythingResponse>('newsapi', url, {
      method: 'GET',
      headers: {
        // Header-based auth is preferred over ?apiKey= because the key never
        // ends up in CDN access logs / Next.js fetch cache keys.
        'X-Api-Key': apiKey,
        Accept: 'application/json',
        'User-Agent': APEX_USER_AGENT,
      },
      // Next.js extended fetch · ISR on the server side.
      next: { revalidate, tags: [NEWS_CACHE_TAG, 'news:newsapi'] },
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, ...opts });
    if (json?.status !== 'ok' || !Array.isArray(json.articles) || json.articles.some(article =>
      !isRecord(article) || typeof article.title !== 'string' || typeof article.url !== 'string' || typeof article.publishedAt !== 'string' ||
      !isRecord(article.source) || typeof article.source.name !== 'string' ||
      ['author','description','content','urlToImage'].some(key => article[key] != null && typeof article[key] !== 'string')
    )) throw new ProviderError('newsapi', 'invalid-response');

    return json.articles.filter(isUsableArticle);
  } catch (error) {
    return failOr('newsapi', error, opts.strict, []);
  }
}

/* ------------------------------------------------------------------ */
/* internals                                                          */
/* ------------------------------------------------------------------ */

function buildEverythingUrl(input: { query: string; pageSize: number }): string {
  const u = new URL(NEWSAPI_ENDPOINT);
  u.searchParams.set('q', input.query);
  u.searchParams.set('sortBy', 'publishedAt');
  u.searchParams.set('language', 'en');
  u.searchParams.set('pageSize', String(input.pageSize));
  return u.toString();
}

function clampPageSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 100) return 100;
  return i;
}

/**
 * NewsAPI flags articles whose publisher revoked the license as "[Removed]"
 * across every text field. They are unrenderable · drop them up front.
 */
function isUsableArticle(a: NewsAPIArticle): boolean {
  if (!a || typeof a.url !== 'string' || typeof a.title !== 'string') return false;
  if (!a.url || !a.title) return false;
  if (a.title === '[Removed]') return false;
  if (a.url === 'https://removed.com') return false;
  return true;
}
