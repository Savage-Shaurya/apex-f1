import type {
  CurrentsNewsItem,
  CurrentsSearchEnvelope,
  CurrentsSearchParams,
} from './types';
import { ProviderError, failOr, isRecord, requestJson, type ProviderRequestOptions } from '../transport';
import { NEWS_CACHE_TAG } from '../cache-tags';

const BASE = 'https://api.currentsapi.services/v1';

/** Defaults used by the F1 news rail. */
const F1_DEFAULTS = {
  keywords: 'formula 1',
  category: 'sports',
  language: 'en',
  /** Per-key cache floor; actual account allocation must be verified. */
  revalidate: 600,
} as const;

function buildSearchUrl(params: CurrentsSearchParams, apiKey: string): URL {
  const url = new URL(`${BASE}/search`);
  if (params.keywords) url.searchParams.set('keywords', params.keywords);
  if (params.language) url.searchParams.set('language', params.language);
  if (params.country) url.searchParams.set('country', params.country);
  if (params.category) url.searchParams.set('category', params.category);
  if (params.domain) url.searchParams.set('domain', params.domain);
  if (params.startDate) url.searchParams.set('start_date', params.startDate);
  if (params.endDate) url.searchParams.set('end_date', params.endDate);
  if (params.page !== undefined) url.searchParams.set('page_number', String(params.page));
  url.searchParams.set('apiKey', apiKey);
  return url;
}

interface CurrentsFetchOpts extends ProviderRequestOptions {
  strict?: boolean;
  revalidate?: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Low-level: hit /search once with the supplied params. Throws on non-2xx
 * so callers can decide their failure policy. The public helper below
 * swallows errors and returns [].
 */
export async function currentsSearch(
  params: CurrentsSearchParams,
  opts: CurrentsFetchOpts = {},
): Promise<CurrentsNewsItem[]> {
  const apiKey = process.env['CURRENTS_API_KEY'];
  if (!apiKey) return failOr('currents', new ProviderError('currents', 'configuration'), opts.strict, []);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = buildSearchUrl(params, apiKey);

  const env = await requestJson<CurrentsSearchEnvelope>('currents', url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: opts.revalidate ?? 600, tags: [NEWS_CACHE_TAG, 'news:currents'] },
  } as RequestInit, { ...opts, fetchImpl });
  if (env?.status !== 'ok' || !Array.isArray(env.news) || env.news.some(item =>
    !isRecord(item) || ['id','title','url','published'].some(key => typeof item[key] !== 'string')
  )) throw new ProviderError('currents', 'invalid-response');
  return env.news ?? [];
}

/**
 * F1 news rail entry point: one keyword query restricted to sports.
 * Returns [] on failure by default; strict:true exposes upstream failures.
 */
export async function getCurrentsF1News(
  opts: CurrentsFetchOpts & { revalidate?: number } = {},
): Promise<CurrentsNewsItem[]> {
  const apiKey = process.env['CURRENTS_API_KEY'];
  if (!apiKey) return failOr('currents', new ProviderError('currents', 'configuration'), opts.strict, []);

  const revalidate = Math.max(600, opts.revalidate ?? F1_DEFAULTS.revalidate);

  try {
    const items = await currentsSearch(
      {
        keywords: F1_DEFAULTS.keywords,
        language: F1_DEFAULTS.language,
        category: F1_DEFAULTS.category,
      },
      { ...opts, revalidate },
    );

    items.sort(
      (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime(),
    );

    return items;
  } catch (error) {
    return failOr('currents', error, opts.strict, []);
  }
}
