// NewsAPI.org · raw response shapes for the /v2/everything endpoint.
//
// Endpoint:    GET https://newsapi.org/v2/everything
// Auth:        X-Api-Key: <NEWSAPI_KEY>          (header preferred over ?apiKey=)
// Free tier:   100 req/day, dev-only · see client.ts for the CORS / origin caveat.
// Docs:        https://newsapi.org/docs/endpoints/everything
//
// We pin the search to the F1 universe and ask for the newest 20 EN-language
// articles. Query string is OR-joined so we catch any of the common phrasings
// fans use across publishers.

/** Canonical query string used by getNewsAPIF1News. Kept exported so callers / tests can introspect it. */
export const NEWSAPI_F1_QUERY =
  '"formula 1" OR "F1 GP" OR "Verstappen" OR "Hamilton"';

/** Sort orders supported by NewsAPI /everything. We always want newest-first. */
export type NewsAPISortBy = 'relevancy' | 'popularity' | 'publishedAt';

/** Top-level status field. Free tier returns "error" with a message on 4xx. */
export type NewsAPIStatus = 'ok' | 'error';

/** Source block inlined on every article. id is null for many smaller publishers. */
export interface NewsAPISource {
  id: string | null;
  name: string;
}

/** One article record as returned by /v2/everything. */
export interface NewsAPIArticle {
  source: NewsAPISource;
  /** Byline. Can be null (wire copy) or a comma-separated list of names. */
  author: string | null;
  title: string;
  /** Short dek. NewsAPI sometimes returns "[Removed]" for de-listed items · we filter those. */
  description: string | null;
  /** Canonical article URL. Required · items without a URL are dropped. */
  url: string;
  /** Hero image. May be null; mapper falls back to the source favicon. */
  urlToImage: string | null;
  /** ISO-8601 UTC. */
  publishedAt: string;
  /** First ~200 chars of body. Truncated by NewsAPI itself on the free tier. */
  content: string | null;
}

/** Successful /v2/everything envelope. */
export interface NewsAPIEverythingOk {
  status: 'ok';
  totalResults: number;
  articles: NewsAPIArticle[];
}

/** Error envelope. We map every non-ok status to [] in the client. */
export interface NewsAPIEverythingError {
  status: 'error';
  /** Machine-readable: "apiKeyInvalid" | "rateLimited" | "corsNotAllowed" | ... */
  code: string;
  message: string;
}

export type NewsAPIEverythingResponse =
  | NewsAPIEverythingOk
  | NewsAPIEverythingError;

/** Options accepted by the typed client. */
export interface GetNewsAPIF1NewsOptions {
  strict?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** 1-100. Defaults to 20. NewsAPI caps free tier at 100 per request. */
  pageSize?: number;
  /** Next.js fetch revalidate seconds. Defaults to 900 (15 minutes). */
  revalidate?: number;
}
