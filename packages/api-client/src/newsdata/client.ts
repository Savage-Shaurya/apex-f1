// Typed NewsData.io client.
//
// Hard ceiling on the free tier is 200 requests/day, so:
//   - we default to a 600s ISR cache (≈ 144 calls/day worst case),
//   - we coalesce five default languages into one request via comma-sep,
//   - we hard-cap page size to 10 (NewsData's free-tier max per call),
//   - we return [] on any error (missing key, network, rate-limit) so the
//     calling UI shows an empty state instead of a 500.
//
// Key auth: `apikey` is a QUERY param, not a header.

import type {
  NewsDataArticleRaw,
  NewsDataNewsResponse,
  NewsDataLanguageIso,
} from './types';
import { NEWSDATA_LANG_TOKEN } from './types';
import { ProviderError, failOr, isRecord, requestJson, type ProviderRequestOptions } from '../transport';
import { NEWS_CACHE_TAG } from '../cache-tags';

const BASE = 'https://newsdata.io/api/1/news';

/** The free request supports five languages. Portuguese can be requested explicitly. */
const DEFAULT_LANGUAGES: NewsDataLanguageIso[] = [
  'en', // global / British / Australian
  'it', // Ferrari beat (Gazzetta dello Sport, La Repubblica)
  'es', // Alonso + Sainz + Latin-American syndication
  'de', // Mercedes / Audi / Hülkenberg
  'fr', // Pierre Gasly + Ocon + AlphaTauri
];

export interface GetNewsDataF1NewsOpts extends ProviderRequestOptions {
  strict?: boolean;
  /** Hard cap on items returned (≤ 10). */
  pageSize?: number;
  /** One to five languages per request; default en,it,es,de,fr. */
  languages?: NewsDataLanguageIso[];
  /** ISR revalidate window in seconds. Default 600s = 10 minutes. */
  revalidate?: number;
  /** Override fetch (for tests). */
  fetchImpl?: typeof fetch;
  /** Override env-key read (for tests). */
  apiKey?: string;
}

interface FetchPageOpts extends ProviderRequestOptions {
  strict?: boolean;
  apiKey: string;
  q: string;
  language: string;
  category: string;
  size: number;
  page?: string;
  revalidate: number;
  fetchImpl: typeof fetch;
}

async function fetchPage(opts: FetchPageOpts): Promise<NewsDataNewsResponse | null> {
  const url = new URL(BASE);
  url.searchParams.set('apikey', opts.apiKey);
  url.searchParams.set('q', opts.q);
  url.searchParams.set('language', opts.language);
  url.searchParams.set('category', opts.category);
  url.searchParams.set('size', String(opts.size));
  if (opts.page) url.searchParams.set('page', opts.page);

  try {
    const json = await requestJson<NewsDataNewsResponse>('newsdata', url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: opts.revalidate, tags: [NEWS_CACHE_TAG, 'news:newsdata'] },
    } as RequestInit, opts);
    if (json?.status !== 'success' || !Array.isArray(json.results) || json.results.some(article =>
      !isRecord(article) || typeof article.title !== 'string' || typeof article.link !== 'string' || typeof article.pubDate !== 'string'
    )) throw new ProviderError('newsdata', 'invalid-response');
    return json;
  } catch (error) {
    return failOr('newsdata', error, opts.strict, null);
  }
}

/**
 * Fetch F1 news from NewsData.io across configured languages.
 * Always returns [] on missing key / network failure / bad response;
 * the caller is expected to merge with other providers.
 */
export async function getNewsDataF1News(
  opts: GetNewsDataF1NewsOpts = {},
): Promise<NewsDataArticleRaw[]> {
  const apiKey = opts.apiKey ?? process.env.NEWSDATA_API_KEY;
  if (!apiKey) return failOr('newsdata', new ProviderError('newsdata', 'configuration'), opts.strict, []);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const pageSize = Math.max(1, Math.min(Math.trunc(opts.pageSize ?? 10) || 10, 10));
  const revalidate = Math.max(600, opts.revalidate ?? 600);
  const langs = [...new Set(opts.languages ?? DEFAULT_LANGUAGES)];
  if (langs.length === 0 || langs.length > 5 || langs.some(lang => !NEWSDATA_LANG_TOKEN[lang])) {
    return failOr('newsdata', new ProviderError('newsdata', 'invalid-input'), opts.strict, []);
  }
  const language = langs.map(lang => NEWSDATA_LANG_TOKEN[lang]).join(',');

  const json = await fetchPage({
    ...opts,
    apiKey,
    q: 'formula 1',
    language,
    category: 'sports',
    size: pageSize,
    revalidate,
    fetchImpl,
  });

  if (!json) return [];

  // Drop NewsData's own duplicates flag if present.
  return json.results.filter((a) => a && typeof a.title === 'string' && typeof a.link === 'string' && !a.duplicate);
}

/**
 * Fetch one specific language. Used when a UI surface wants a focused stream
 * (e.g. an "Italian Ferrari coverage" rail on the driver profile page).
 */
export async function getNewsDataF1NewsByLanguage(
  language: NewsDataLanguageIso,
  opts: GetNewsDataF1NewsOpts = {},
): Promise<NewsDataArticleRaw[]> {
  return getNewsDataF1News({
    ...opts,
    pageSize: opts.pageSize,
    revalidate: opts.revalidate,
    apiKey: opts.apiKey,
    languages: [language],
  });
}
