import type {
  GuardianContentItem,
  GuardianSearchEnvelope,
  GuardianSearchParams,
} from './types';
import { ProviderError, failOr, isRecord, requestJson, type ProviderRequestOptions } from '../transport';
import { NEWS_CACHE_TAG } from '../cache-tags';

const BASE = 'https://content.guardianapis.com';

/** Defaults we use for the F1 news rail. Locked at the call site, not env. */
const F1_DEFAULTS = {
  /** Most reliable F1 funnel · tag is editorially curated by Guardian themselves. */
  tag: 'sport/formula-one',
  section: 'sport',
  showFields: ['trailText', 'thumbnail', 'byline'] as const,
  orderBy: 'newest' as const,
  pageSize: 20,
  revalidate: 600,
} as const;

/** Build the /search URL with the configured params + api-key from env. */
function buildSearchUrl(params: GuardianSearchParams, apiKey: string): URL {
  const url = new URL(`${BASE}/search`);
  if (params.q) url.searchParams.set('q', params.q);
  if (params.section) url.searchParams.set('section', params.section);
  if (params.tag) url.searchParams.set('tag', params.tag);
  if (params.pageSize !== undefined) url.searchParams.set('page-size', String(params.pageSize));
  if (params.page !== undefined) url.searchParams.set('page', String(params.page));
  if (params.orderBy) url.searchParams.set('order-by', params.orderBy);
  if (params.showFields && params.showFields.length > 0) {
    url.searchParams.set('show-fields', params.showFields.join(','));
  }
  if (params.fromDate) url.searchParams.set('from-date', params.fromDate);
  if (params.toDate) url.searchParams.set('to-date', params.toDate);
  if (params.lang) url.searchParams.set('lang', params.lang);
  url.searchParams.set('api-key', apiKey);
  return url;
}

interface GuardianFetchOpts extends ProviderRequestOptions {
  strict?: boolean;
  pageSize?: number;
  revalidate?: number;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Low-level: hit /search once with the supplied params. Throws on non-2xx
 * so callers can decide their failure policy. The public helper below
 * swallows errors and returns [].
 */
export async function guardianSearch(
  params: GuardianSearchParams,
  opts: GuardianFetchOpts = {},
): Promise<GuardianContentItem[]> {
  const apiKey = process.env['GUARDIAN_API_KEY'];
  if (!apiKey) return failOr('guardian', new ProviderError('guardian', 'configuration'), opts.strict, []);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = buildSearchUrl(params, apiKey);

  const env = await requestJson<GuardianSearchEnvelope>('guardian', url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: opts.revalidate ?? 600, tags: [NEWS_CACHE_TAG, 'news:guardian'] },
  } as RequestInit, { ...opts, fetchImpl });
  if (env?.response?.status !== 'ok' || !Array.isArray(env.response.results) || env.response.results.some(item =>
    !isRecord(item) || ['id','webTitle','webUrl','webPublicationDate'].some(key => typeof item[key] !== 'string')
  )) throw new ProviderError('guardian', 'invalid-response');
  return env.response.results;
}

/**
 * F1 news rail entry point: one curated sport/formula-one tag query.
 * Returns [] on failure by default; strict:true exposes upstream failures.
 *
 * Cached for at least 600s via Next.js ISR.
 */
export async function getGuardianF1News(
  opts: GuardianFetchOpts = {},
): Promise<GuardianContentItem[]> {
  const apiKey = process.env['GUARDIAN_API_KEY'];
  if (!apiKey) return failOr('guardian', new ProviderError('guardian', 'configuration'), opts.strict, []);

  const pageSize = opts.pageSize ?? F1_DEFAULTS.pageSize;
  const revalidate = Math.max(600, opts.revalidate ?? F1_DEFAULTS.revalidate);
  const showFields = [...F1_DEFAULTS.showFields];

  try {
    // Tag-only query. The keyword fallback was matching ANY article inside
    // section=sport that contained the words "formula" or "1" anywhere
    // (including County Cricket live blogs). Guardian's sport/formula-one
    // tag is editorially curated by their own team and only fires on
    // genuine F1 content. Loses some breadth, gains 100% relevance.
    const items = await guardianSearch(
      {
        tag: F1_DEFAULTS.tag,
        pageSize,
        orderBy: F1_DEFAULTS.orderBy,
        showFields,
      },
      { ...opts, revalidate },
    );

    items.sort(
      (a, b) =>
        new Date(b.webPublicationDate).getTime() - new Date(a.webPublicationDate).getTime(),
    );

    return items;
  } catch (error) {
    return failOr('guardian', error, opts.strict, []);
  }
}
