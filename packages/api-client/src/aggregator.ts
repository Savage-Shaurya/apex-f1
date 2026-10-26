// Unified F1 news aggregator.
//
// Combines every news provider the platform supports into a single
// `RssItem[]` stream, deduplicated by title-link similarity and
// sorted newest-first.
//
// Currently wired:
//   - RSS (4 sources)        @apex/api-client/rss
//   - Guardian               @apex/api-client/guardian
//   - GNews                  @apex/api-client/gnews
//   - NewsData (sentiment + multi-language)  @apex/api-client/newsdata
//
// The legacy array reader remains available. Status-aware readers distinguish
// successful empty sources from partial/total provider failure.

import { getF1NewsFeed as getRssNewsFeed, type RssItem } from './rss';
import { getGuardianF1News, mapGuardianItems } from './guardian';
import { getGNewsF1News, mapGNewsArticles } from './gnews';
import { getNewsDataF1News, mapNewsDataArticles } from './newsdata';
import { getNewsAPIF1News, mapNewsAPIArticlesToUi } from './newsapi';
import { uiToRssItems } from './rss';
import { getCurrentsF1News, mapCurrentsItems } from './currents';
import { ProviderError } from './transport';
import { applyNewsPolicy, dropNearDuplicates, emptyPolicyReport, type NewsPolicyReport } from './news-policy';
export type { NewsPolicyReport } from './news-policy';

export interface AggregatedNewsOptions {
  /** Soft cap on the merged result. Default 80. */
  limit?: number;
  /** ISR revalidate seconds passed to every provider. Default 300. */
  revalidate?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Selectively disable a provider (e.g. for /latest "GNews only" view). */
  providers?: {
    rss?: boolean;
    guardian?: boolean;
    gnews?: boolean;
    newsdata?: boolean;
    newsapi?: boolean;
    currents?: boolean;
  };
}
export interface AggregatedNewsSource {
  source: string;
  /**
   * `rejected` means the provider refused our credentials (HTTP 401/403). That
   * is not a temporary outage: the source stays off until a new key is
   * configured, and pages say so instead of promising a retry.
   */
  state: 'available' | 'unavailable' | 'rejected' | 'unconfigured' | 'disabled';
  /** Rows the provider returned, before the F1 news policy. */
  items: number;
  /** Rows from this provider that passed the policy and dedupe and are in `items`. */
  kept?: number;
}
export interface AggregatedNewsResult {
  items: RssItem[];
  availability: 'available' | 'partial' | 'unavailable';
  sources: AggregatedNewsSource[];
  /** What the F1-only news policy removed (docs/NEWS-POLICY.md). */
  policy: NewsPolicyReport;
}

function credentialsRejected(error: unknown): boolean {
  return error instanceof ProviderError && error.code === 'http' && (error.status === 401 || error.status === 403);
}

/** Identifier slug -> friendly label for the /latest source pill. */
export const NEWS_PROVIDERS = [
  { id: 'rss', label: 'RSS aggregate' },
  { id: 'guardian', label: 'The Guardian' },
  { id: 'gnews', label: 'GNews' },
  { id: 'newsdata', label: 'NewsData' },
  { id: 'newsapi', label: 'NewsAPI' },
  { id: 'currents', label: 'Currents' },
] as const;

/**
 * Lowercased, alnum-only title fingerprint. Two articles with the same
 * fingerprint are treated as duplicates (typical case: a wire story
 * picked up by multiple publishers).
 */
function fingerprint(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize an article URL so trivial query-string drift doesn't defeat dedup. */
function urlKey(link: string): string {
  try {
    const u = new URL(link);
    // Strip common tracking params.
    for (const p of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'CMP',
      'ref',
    ]) {
      u.searchParams.delete(p);
    }
    u.searchParams.sort();
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return link.toLowerCase();
  }
}

/**
 * Merge an arbitrary number of provider result lists into a single
 * deduplicated, newest-first stream.
 *
 * Dedup strategy:
 *   1. Drop any item whose normalized URL has already been seen.
 *   2. Drop any item whose title fingerprint has already been seen.
 *
 * Order of provider lists matters: the first-seen variant wins. We pass
 * RSS first (highest editorial fidelity), Guardian second, GNews last
 * (delayed feed - lowest priority on collisions).
 */
function mergeAndDedupe(lists: RssItem[][]): RssItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const out: RssItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (!item.title || !item.link) continue;
      const uk = urlKey(item.link);
      const fp = fingerprint(item.title);
      if (seenUrls.has(uk) || (fp && seenTitles.has(fp))) continue;
      seenUrls.add(uk);
      if (fp) seenTitles.add(fp);
      out.push(item);
    }
  }
  out.sort((a, b) => b.pubDateMs - a.pubDateMs);
  return out;
}

/**
 * Fetch from every enabled provider in parallel and return one merged list.
 *
 * Never throws. Each provider is independently fault-tolerant; if one
 * returns [], the others still flow through.
 */
export async function getAggregatedF1News(
  opts: AggregatedNewsOptions = {},
): Promise<RssItem[]> {
  return (await getAggregatedF1NewsResult(opts)).items;
}
export async function getAggregatedF1NewsResult(opts: AggregatedNewsOptions = {}): Promise<AggregatedNewsResult> {
  const limit = Number.isFinite(opts.limit) ? Math.max(1, Math.min(500, Math.trunc(opts.limit!))) : 80;
  const revalidate = opts.revalidate ?? 300;
  const enabled = {
    rss: opts.providers?.rss !== false,
    guardian: opts.providers?.guardian !== false,
    gnews: opts.providers?.gnews !== false,
    newsdata: opts.providers?.newsdata !== false,
    newsapi: opts.providers?.newsapi !== false,
    currents: opts.providers?.currents !== false,
  };

  const sources: AggregatedNewsSource[] = [];
  // The RSS reader applies the policy to its own feeds first; its rejections
  // are folded into this render's report below.
  const rssPolicy = emptyPolicyReport();
  const call = { revalidate, strict: true, fetchImpl: opts.fetchImpl, signal: opts.signal };
  async function provider(source: string, active: boolean, key: string | undefined, operation: () => Promise<RssItem[]>): Promise<RssItem[]> {
    if (!active || !key?.trim()) { sources.push({ source, state: active ? 'unconfigured' : 'disabled', items: 0 }); return []; }
    try { const items = await operation(); sources.push({ source, state: 'available', items: items.length }); return items; }
    catch (error) { sources.push({ source, state: credentialsRejected(error) ? 'rejected' : 'unavailable', items: 0 }); return []; }
  }
  async function rss(): Promise<RssItem[]> {
    if (!enabled.rss) { sources.push({ source: 'RSS aggregate', state: 'disabled', items: 0 }); return []; }
    let reported = 0;
    try {
      return await getRssNewsFeed({ ...call, includeGuardian: false, includeNewsAPI: false, includeNewsData: false, includeCurrents: false, enrichImages: false, policyReport: rssPolicy,
        onSourceResult: (report) => { reported++; sources.push({ source: report.source, state: report.ok ? 'available' : 'unavailable', items: report.items }); } });
    } catch {
      // RSS normally reports each publisher before throwing for total failure.
      if (!reported) sources.push({ source: 'RSS aggregate', state: 'unavailable', items: 0 });
      return [];
    }
  }
  const [rssItems, guardianItems, gnewsItems, currentsItems, newsDataItems, newsApiItems] = await Promise.all([
    rss(),
    provider('The Guardian', enabled.guardian, process.env.GUARDIAN_API_KEY, () => getGuardianF1News(call).then((raw) => mapGuardianItems(raw).map(item => ({ ...item, provider: 'guardian' as const })))),
    provider('GNews', enabled.gnews, process.env.GNEWS_API_KEY, () => getGNewsF1News(call).then((raw) => mapGNewsArticles(raw).map(item => ({ ...item, provider: 'gnews' as const })))),
    provider('Currents', enabled.currents, process.env.CURRENTS_API_KEY, () => getCurrentsF1News(call).then((raw) => mapCurrentsItems(raw).map(item => ({ ...item, provider: 'currents' as const })))),
    provider('NewsData', enabled.newsdata, process.env.NEWSDATA_API_KEY, () => getNewsDataF1News({ ...call, pageSize: 10, revalidate: Math.max(revalidate, 600) }).then((raw) => mapNewsDataArticles(raw) as unknown as RssItem[])),
    provider('NewsAPI', enabled.newsapi, process.env.NEWSAPI_KEY, () => getNewsAPIF1News({ ...call, pageSize: 20, revalidate: Math.max(revalidate, 1000) }).then((raw) => uiToRssItems(mapNewsAPIArticlesToUi(raw)))),
  ]);

  // Provider tags drive the policy (curated feed vs keyword search), so stamp
  // them before classifying. Order matters for every tie-break below: curated
  // RSS wins over Guardian over the keyword APIs, GNews (delayed) and Currents last.
  const tag = (items: RssItem[], provider: NonNullable<RssItem['provider']>) => items.map((item): RssItem => ({ ...item, provider: item.provider ?? provider }));
  const ordered = [
    ...tag(rssItems, 'rss'), ...tag(guardianItems, 'guardian'), ...tag(newsApiItems, 'newsapi'),
    ...tag(newsDataItems, 'newsdata'), ...tag(gnewsItems, 'gnews'), ...tag(currentsItems, 'currents'),
  ];
  const policy = emptyPolicyReport();
  const allowed = applyNewsPolicy(ordered, policy);
  for (const [reason, count] of Object.entries(rssPolicy.rejected) as Array<[keyof NewsPolicyReport['rejected'], number]>) {
    policy.rejected[reason] = (policy.rejected[reason] ?? 0) + count;
    policy.considered += count;
  }
  const exact = mergeAndDedupe([allowed]);
  // mergeAndDedupe sorts newest-first; near-duplicate collapse must keep the
  // most trusted copy, so it runs over the priority order and filters `exact`.
  const exactSet = new Set(exact);
  const unique = new Set(dropNearDuplicates(allowed.filter((item) => exactSet.has(item))));
  const merged = exact.filter((item) => unique.has(item));
  const duplicates = allowed.length - merged.length;
  if (duplicates > 0) policy.rejected.duplicate = (policy.rejected.duplicate ?? 0) + duplicates;
  policy.kept = merged.length;
  const shown = merged.slice(0, limit);
  for (const source of sources) {
    if (source.state !== 'available') continue;
    source.kept = shown.filter((item) => sourceOf(item) === source.source).length;
  }
  const available = sources.filter((source) => source.state === 'available').length;
  const unavailable = sources.some((source) => source.state === 'unavailable');
  return { items: shown, availability: available === 0 ? 'unavailable' : unavailable ? 'partial' : 'available', sources: sources.sort((a, b) => a.source.localeCompare(b.source)), policy };
}

const PROVIDER_SOURCE: Record<string, string> = { guardian: 'The Guardian', gnews: 'GNews', newsdata: 'NewsData', newsapi: 'NewsAPI', currents: 'Currents' };
/** The `sources[]` entry a row belongs to: its RSS feed name, or its API provider. */
function sourceOf(item: RssItem): string {
  return item.provider && item.provider !== 'rss' ? PROVIDER_SOURCE[item.provider] ?? item.source : item.source;
}
