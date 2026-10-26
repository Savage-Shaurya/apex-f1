// GNews.io raw response shapes for /api/v4/search.
// Docs: https://gnews.io/docs/v4#search-endpoint
//
// IMPORTANT · free-tier constraint:
//   The free plan applies a *12-hour publication delay* on every article.
//   That is, an article published at T appears in /search no earlier
//   than T + 12h. Real-time access is locked behind the paid tier
//   ("Essential" and above). Treat GNews as an *archive / depth* feed,
//   not a breaking-news feed. See `client.ts` header for the full note.

/** Endpoint base URL (no trailing slash). */
export const GNEWS_BASE = 'https://gnews.io/api/v4';

/** Hard free-tier ceiling: 100 requests / 24h, 10 articles / request. */
export const GNEWS_FREE_TIER_DAILY_LIMIT = 100;
export const GNEWS_FREE_TIER_MAX_PER_REQUEST = 10;

/** Free-tier publication delay (milliseconds). */
export const GNEWS_FREE_TIER_DELAY_MS = 12 * 60 * 60 * 1000;

/** Supported `sortby` values. */
export type GNewsSortBy = 'publishedAt' | 'relevance';

/** Supported `lang` values (subset · full list in docs). */
export type GNewsLang =
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'it'
  | 'pt'
  | 'nl'
  | 'ru'
  | 'ja'
  | 'zh'
  | 'ar';

/** Supported `country` values (subset · `'any'` is our sentinel for "no filter"). */
export type GNewsCountry =
  | 'any'
  | 'us'
  | 'gb'
  | 'au'
  | 'ca'
  | 'it'
  | 'fr'
  | 'de'
  | 'es'
  | 'nl'
  | 'br'
  | 'jp';

/** Query parameters accepted by /api/v4/search. */
export interface GNewsSearchParams {
  /** Search query. Supports `AND` / `OR` / `NOT` and exact phrases via quotes. */
  q: string;
  /** Language filter. */
  lang?: GNewsLang;
  /** Country filter. Pass `'any'` (our sentinel) to omit the param entirely. */
  country?: GNewsCountry;
  /** Max articles to return. Free tier caps at 10. */
  max?: number;
  /** Sort order. `publishedAt` = newest-first. */
  sortby?: GNewsSortBy;
  /** ISO-8601 lower bound, inclusive. */
  from?: string;
  /** ISO-8601 upper bound, inclusive. */
  to?: string;
  /** Where to search the query string. Defaults to `title,description`. */
  in?: 'title' | 'description' | 'content' | 'title,description' | 'title,content';
  /** Comma-separated publisher domains to exclude (e.g. `foo.com,bar.com`). */
  expand?: 'content';
  /** Comma-separated publisher domains to allow-list. */
  nullable?: 'image' | 'description' | 'image,description';
}

/** Source block embedded on every article. */
export interface GNewsSource {
  /** Display name, e.g. "BBC News". */
  name: string;
  /** Canonical site URL, e.g. "https://www.bbc.co.uk". */
  url: string;
}

/** A single article in the GNews response. */
export interface GNewsArticle {
  /** Article headline. */
  title: string;
  /** Short summary (1 - 2 sentences). May be `null` if `nullable=description`. */
  description: string | null;
  /** Optional article body (only present on paid tier with `expand=content`). */
  content: string | null;
  /** Canonical article URL. */
  url: string;
  /** Cover image URL. May be `null` if `nullable=image`. */
  image: string | null;
  /** ISO-8601 publication timestamp (UTC). */
  publishedAt: string;
  /** Source descriptor. */
  source: GNewsSource;
}

/** Successful /api/v4/search envelope. */
export interface GNewsSearchResponse {
  /** Total articles matching the query across all pages. */
  totalArticles: number;
  /** Articles for this page. Length <= `max`. */
  articles: GNewsArticle[];
}

/** Error envelope. GNews returns this shape with HTTP 4xx / 5xx. */
export interface GNewsErrorResponse {
  errors: string[];
}

/** Union of the two possible responses. */
export type GNewsResponse = GNewsSearchResponse | GNewsErrorResponse;

/** Narrowing helper. */
export function isGNewsError(r: GNewsResponse): r is GNewsErrorResponse {
  return Array.isArray((r as GNewsErrorResponse).errors);
}
