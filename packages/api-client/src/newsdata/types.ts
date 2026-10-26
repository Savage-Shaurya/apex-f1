// NewsData.io raw response types for /api/1/news
// Endpoint: https://newsdata.io/api/1/news
// Docs: https://newsdata.io/documentation
//
// Key differentiators vs other news APIs:
//   1. Returns a `sentiment` field ('positive' | 'neutral' | 'negative') per article
//      on paid tiers; free tier may return null. We type it as optional + nullable
//      so the mapper degrades cleanly.
//   2. Returns `language` as a full English lowercase string ("english", "italian",
//      "spanish"...) NOT an ISO code. Mapper converts to ISO 639-1 for UI.
//   3. Returns `country` as an array of ISO 3166-1 alpha-2 codes (lowercase).
//   4. Returns `category` as an array of strings.
//   5. Returns optional `ai_tag`, `ai_region`, `ai_org`, `sentiment_stats` on
//      higher-tier plans. Typed as optional unknown to avoid lying about coverage.
//   6. Pagination is via `nextPage` cursor token, NOT page numbers.

/** Sentiment label as returned by NewsData.io. */
export type NewsDataSentiment = 'positive' | 'neutral' | 'negative';

/** A single article in the NewsData /news response. */
export interface NewsDataArticleRaw {
  /** Globally unique article id (stable across pagination). */
  article_id: string;
  title: string;
  /** Canonical article URL. */
  link: string;
  /** Author array (may be ["unknown"] or absent). */
  creator: string[] | null;
  /** Some publishers include a video URL alongside the text article. */
  video_url: string | null;
  /** Short summary, may be HTML-stripped already, may be null. */
  description: string | null;
  /** Full article body when available, otherwise null on free tier. */
  content: string | null;
  /** "YYYY-MM-DD HH:MM:SS" in UTC. NewsData does NOT append a Z. */
  pubDate: string;
  /** Lead image url (may be a CDN URL, may be null). */
  image_url: string | null;
  /** Publisher slug, e.g. "motorsport". */
  source_id: string;
  /** Source priority weighting (lower = more authoritative per NewsData). */
  source_priority: number;
  /** Publisher display name. */
  source_name?: string;
  source_url?: string;
  source_icon?: string | null;
  /** ISO 3166-1 alpha-2 country codes, lowercase. */
  country: string[];
  /** Categories assigned by NewsData. */
  category: string[];
  /** Language as a full English lowercase word: "english", "italian", "spanish". */
  language: string;
  /** Sentiment label. Present on paid plans, null on free tier. */
  sentiment?: NewsDataSentiment | null;
  /** Sentiment confidence breakdown (paid plans only). */
  sentiment_stats?: {
    positive: number;
    neutral: number;
    negative: number;
  } | null;
  /** AI-extracted tags (paid plans). */
  ai_tag?: string[] | null;
  /** AI-classified region (paid plans). */
  ai_region?: string[] | null;
  /** AI-classified orgs (paid plans). */
  ai_org?: string[] | null;
  /** Duplicate-detection flag from NewsData. */
  duplicate?: boolean;
}

/** Top-level NewsData /news response envelope. */
export interface NewsDataNewsResponse {
  status: 'success' | 'error';
  /** Total results matched server-side (not page size). */
  totalResults: number;
  results: NewsDataArticleRaw[];
  /** Opaque cursor for the next page. Null when exhausted. */
  nextPage: string | null;
}

/** Error envelope (status === 'error'). */
export interface NewsDataErrorResponse {
  status: 'error';
  results: {
    message: string;
    code: string;
  };
}

/** Languages we whitelist for F1 coverage. */
export type NewsDataLanguageIso = 'en' | 'it' | 'es' | 'pt' | 'de' | 'fr';

/** NewsData wants their language tokens, NOT ISO. Map ISO → NewsData token. */
export const NEWSDATA_LANG_TOKEN: Record<NewsDataLanguageIso, string> = {
  en: 'en',
  it: 'it',
  es: 'es',
  pt: 'pt',
  de: 'de',
  fr: 'fr',
};

/** Reverse: full English language word (as returned in results) → ISO 639-1. */
export const NEWSDATA_LANG_FROM_LABEL: Record<string, NewsDataLanguageIso> = {
  english: 'en',
  italian: 'it',
  spanish: 'es',
  portuguese: 'pt',
  german: 'de',
  french: 'fr',
};
