import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ProviderError, failOr, isRecord, readLimitedText, withProviderDeadline, type ProviderRequestOptions } from '../transport';
import { NEWS_CACHE_TAG, RSS_NEWS_CACHE_TAG } from '../cache-tags';
import { hasXmlDoctype } from './xml-policy';
import { apexUserAgent } from '../user-agent';
import { applyNewsPolicy, dropNearDuplicates, type NewsPolicyReport } from '../news-policy';
export { NEWS_CACHE_TAG, RSS_NEWS_CACHE_TAG } from '../cache-tags';
import {
  getNewsAPIF1News,
  mapNewsAPIArticlesToUi,
  type UiNewsItem,
} from '../newsapi';
import type {
  NewsDataSentiment,
  NewsDataLanguageIso,
} from '../newsdata/types';

/** Cap upstream latency so a stalled feed cannot pin a serverless function. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Legacy shape. New code should import UiNewsItem from '@apex/api-client/newsapi'.
 * RssItem is retained so existing imports keep compiling · the aggregator now
 * returns UiNewsItem[] across all providers.
 *
 * Optional `provider` / `sentiment` / `language` / `countries` / `articleId`
 * are populated by the NewsData branch only; every other provider leaves
 * them undefined. UI surfaces must null-check before rendering the sentiment
 * badge or language pill.
 */
export interface RssItem {
  source: string;
  title: string;
  link: string;
  pubDate: string;
  pubDateMs: number;
  description?: string;
  imageUrl?: string;
  author?: string;
  categories?: string[];
  provider?: 'rss' | 'newsapi' | 'guardian' | 'newsdata' | 'gnews' | 'currents';
  sentiment?: NewsDataSentiment | null;
  language?: NewsDataLanguageIso | null;
  countries?: string[];
  articleId?: string;
}

export interface RssSource {
  /** Display name shown on UI. */
  name: string;
  /** Public RSS / Atom feed URL. */
  url: string;
  /** Hostname for fallback favicon. */
  homepage: string;
}

export interface NewsSourceReport {
  source: string;
  ok: boolean;
  items: number;
  /** Only redacted provider errors, never an upstream URL or response body. */
  error?: string;
}

export const F1_RSS_SOURCES: RssSource[] = [
  { name: 'Motorsport.com', url: 'https://www.motorsport.com/rss/f1/news/', homepage: 'https://www.motorsport.com' },
  { name: 'Autosport', url: 'https://www.autosport.com/rss/f1/news/', homepage: 'https://www.autosport.com' },
  { name: 'RaceFans', url: 'https://www.racefans.net/feed/', homepage: 'https://www.racefans.net' },
  { name: 'The Race', url: 'https://www.the-race.com/category/formula-1/rss/', homepage: 'https://www.the-race.com' },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  cdataPropName: '__cdata',
});

function strip(html?: string): string {
  if (!html) return '';
  const text = typeof html === 'string' ? html : String(html);
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImageFrom(html?: string): string | undefined {
  if (!html) return undefined;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1];
}

function toMs(date?: string): number {
  if (!date) return 0;
  const ms = new Date(date).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function cdataOrText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const cd = (v as Record<string, unknown>)['__cdata'];
    if (typeof cd === 'string') return cd;
    const t = (v as Record<string, unknown>)['#text'];
    if (typeof t === 'string') return t;
  }
  return String(v);
}

function parseRss(xml: string, source: string): RssItem[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ProviderError('rss', 'invalid-response');
  }
  const roots = isRecord(parsed) ? Object.keys(parsed).filter((key) => !key.startsWith('?')) : [];
  if (roots.length !== 1 || !['rss', 'feed'].includes(roots[0]!)) throw new ProviderError('rss', 'invalid-response');

  // Standard RSS 2.0
  const rss = parsed['rss'];
  const channel = isRecord(rss) ? rss['channel'] : undefined;
  if (roots[0] === 'rss') {
    if (!isRecord(rss) || !isRecord(channel)) throw new ProviderError('rss', 'invalid-response');
    const items = asArray(channel['item'] as Record<string, unknown> | Record<string, unknown>[] | undefined);
    if (items.some((item) => !isRecord(item))) throw new ProviderError('rss', 'invalid-response');
    return items
      .map((it): RssItem => {
        const title = strip(cdataOrText(it['title']));
        const link = String(it['link'] ?? '');
        const pubDate = String(it['pubDate'] ?? '');
        const enclosure = it['enclosure'] as { '@_url'?: string } | undefined;
        const mediaContent = it['media:content'] as { '@_url'?: string } | undefined;
        const mediaThumb = it['media:thumbnail'] as { '@_url'?: string } | undefined;
        const description = strip(cdataOrText(it['description']));
        return {
          source,
          title,
          link,
          pubDate,
          pubDateMs: toMs(pubDate),
          description,
          imageUrl:
            enclosure?.['@_url'] ??
            mediaContent?.['@_url'] ??
            mediaThumb?.['@_url'] ??
            firstImageFrom(cdataOrText(it['content:encoded'])) ??
            firstImageFrom(cdataOrText(it['description'])),
          author: cdataOrText(it['dc:creator'] ?? it['author']) || undefined,
          categories: asArray(it['category'] as string | string[] | undefined)
            .map((c) => cdataOrText(c))
            .filter(Boolean),
        };
      })
      .filter((i) => i.title && i.link);
  }

  // Atom (YouTube channel feeds use this)
  const feed = parsed['feed'];
  if (roots[0] === 'feed') {
    if (!isRecord(feed)) throw new ProviderError('rss', 'invalid-response');
    const entries = asArray(feed['entry'] as Record<string, unknown> | Record<string, unknown>[] | undefined);
    if (entries.some((entry) => !isRecord(entry))) throw new ProviderError('rss', 'invalid-response');
    return entries
      .map((it): RssItem => {
        const links = asArray(it['link'] as Record<string, unknown> | Record<string, unknown>[] | undefined);
        const link = links.find(row => row['@_rel'] === 'alternate' && typeof row['@_href'] === 'string') ?? links.find(row => !row['@_rel'] && typeof row['@_href'] === 'string');
        const linkHref = typeof link?.['@_href'] === 'string' ? link['@_href'] : '';
        const mediaGroup = it['media:group'] as Record<string, unknown> | undefined;
        const mediaThumb = mediaGroup?.['media:thumbnail'] as { '@_url'?: string } | undefined;
        const mediaDesc = mediaGroup?.['media:description'];
        return {
          source,
          title: strip(cdataOrText(it['title'])),
          link: linkHref,
          pubDate: String(it['published'] ?? it['updated'] ?? ''),
          pubDateMs: toMs(String(it['published'] ?? it['updated'] ?? '')),
          description: strip(cdataOrText(mediaDesc) || cdataOrText(it['summary'])),
          imageUrl: mediaThumb?.['@_url'],
          author: cdataOrText((it['author'] as Record<string, unknown>)?.['name']) || undefined,
        };
      })
      .filter((i) => i.title && i.link);
  }

  throw new ProviderError('rss', 'invalid-response');
}

/**
 * Convert UiNewsItem rows (NewsAPI, etc.) into the aggregator's RssItem shape.
 * RssItem now carries an optional `provider` discriminator, so we keep it
 * intact · downstream UI (e.g. SentimentBadge gating) relies on it.
 */
export function uiToRssItems(items: UiNewsItem[]): RssItem[] {
  return items.map((it) => ({ ...it }));
}

/** Pull og:image (or twitter:image) out of an article's <head>. */
function ogImageFrom(html: string): string | undefined {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/**
 * Fill in imageUrl for items whose feed carried no image.
 *
 * Not every publisher puts an image in the feed. RaceFans is the clear case:
 * its items expose only title, link, comments, dc:creator, pubDate, category,
 * guid, description, wfw:commentRss and slash:comments — no enclosure, no
 * media:*, no content:encoded, and no <img> in the description. parseRss
 * already tries all five of those, so there is nothing left to extract and
 * every one of its items rendered as a blank tile on /latest.
 *
 * Explicit background jobs can attempt the publisher's og:image metadata.
 *
 * Cost control, because this runs inside a cron:
 *   - Only items that are actually missing an image are fetched.
 *   - Bounded concurrency, so a slow publisher cannot stall the batch.
 *   - Its own short timeout, independent of the feed fetch.
 *   - Results should be persisted by the caller; this native, DNS-pinned fetch
 *     does not use Next.js's fetch cache.
 *   - Every failure path leaves imageUrl undefined, and SmartImage's branded
 *     fallback covers it. Enrichment can never make the page worse than it
 *     was before this function existed.
 */
const OG_CONCURRENCY = 3;

export async function enrichMissingNewsImages(items: RssItem[]): Promise<RssItem[]> {
  items = items.map(item => ({ ...item }));
  const targets = items.filter((i) => !i.imageUrl && i.link).slice(0, 12);
  if (targets.length === 0) return items;
  const { fetchArticleHtml } = await import('./safe-html');

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      const item = targets[i];
      if (!item) return;
      try {
        const html = await fetchArticleHtml(item.link);
        const og = ogImageFrom(html);
        if (og) {
          const image = new URL(og, item.link);
          if (image.protocol === 'https:' && !image.username && !image.password) item.imageUrl = image.toString();
        }
      } catch {
        // Leave imageUrl undefined · SmartImage renders the branded fallback.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(OG_CONCURRENCY, targets.length) }, worker),
  );
  return items;
}

async function fetchFeed(source: RssSource, revalidate: number, opts: ProviderRequestOptions & { strict?: boolean; cacheTags?: string[] } = {}): Promise<RssItem[]> {
  try {
    return await withProviderDeadline('rss', async signal => {
    const res = await (opts.fetchImpl ?? fetch)(source.url, {
      headers: {
        'User-Agent': `Mozilla/5.0 (compatible; ${apexUserAgent()})`,
        Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      },
      signal,
      next: { revalidate, ...(opts.cacheTags?.length ? { tags: opts.cacheTags } : {}) },
    } as RequestInit);
    if (!res.ok) throw new ProviderError('rss', 'http', res.status);
    const xml = await readLimitedText(res, 2_000_000, signal);
    if (hasXmlDoctype(xml) || XMLValidator.validate(xml) !== true) throw new ProviderError('rss', 'invalid-response');
    return parseRss(xml, source.name);
    }, { timeoutMs: REQUEST_TIMEOUT_MS, ...opts });
  } catch (error) {
    return failOr('rss', error, opts.strict, []);
  }
}

/** Normalize a title for fuzzy dedupe · lowercase, alphanumerics only. */
function dedupeKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Normalize URLs while retaining meaningful query identifiers. */
function linkKey(link: string): string {
  try {
    const u = new URL(link);
    for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid','gclid','CMP'].includes(key)) u.searchParams.delete(key);
    u.searchParams.sort();
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return link.toLowerCase();
  }
}

/**
 * Cap how many items any single source contributes so one fast publisher
 * cannot dominate the rail. Preserves insertion order (which is already
 * newest-first sorted before this runs).
 */
function capPerSource(items: RssItem[], maxPerSource: number): RssItem[] {
  const counts = new Map<string, number>();
  const out: RssItem[] = [];
  for (const item of items) {
    const n = counts.get(item.source) ?? 0;
    if (n >= maxPerSource) continue;
    counts.set(item.source, n + 1);
    out.push(item);
  }
  return out;
}

/**
 * Aggregate every configured F1 news provider into a single rail.
 *
 * Sources fan out in parallel:
 *   - 4x RSS feeds (Motorsport.com, Autosport, RaceFans, The Race)
 *   - The Guardian Open Platform (when GUARDIAN_API_KEY present)
 *   - NewsAPI.org /v2/everything       (when NEWSAPI_KEY present, server-only)
 *
 * Output is deduped by normalized title + URL host and sorted newest-first
 * with a per-source cap so no single provider drowns the rail. Each provider
 * fails independently · a 429 from NewsAPI does not poison the RSS rows
 * (CORE RULE #1).
 *
 * Provider cache floors reduce refresh frequency for each distinct cache key.
 * They cannot enforce shared account limits across queries, regions or workers.
 * Account entitlements and commercial licensing must be configured separately.
 */
export async function getF1NewsFeed(
  opts: {
    strict?: boolean;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Background jobs can report degraded sources while rendering keeps healthy rows. */
    onSourceResult?: (report: NewsSourceReport) => void;
    /** Explicit background-only metadata work; disabled on render by default. */
    enrichImages?: boolean;
    providers?: { guardian?: boolean; newsapi?: boolean; newsdata?: boolean; currents?: boolean };
    includeGuardian?: boolean;
    limit?: number;
    revalidate?: number;
    maxPerSource?: number;
    /** Set false to skip NewsAPI entirely (quota pinch / debugging). Default true. */
    includeNewsAPI?: boolean;
    /** Set false to skip NewsData (debug / focused rails). Default true. */
    includeNewsData?: boolean;
    /** Set false to skip Currents (debug). Default true. */
    includeCurrents?: boolean;
    /** Receives the news-policy counts (what was filtered and why). */
    policyReport?: NewsPolicyReport;
  } = {},
): Promise<RssItem[]> {
  const revalidate = opts.revalidate ?? 300;
  const maxPerSource = opts.maxPerSource ?? 8;
  const includeNewsAPI = opts.includeNewsAPI !== false && opts.providers?.newsapi !== false;
  const includeNewsData = opts.includeNewsData !== false && opts.providers?.newsdata !== false;
  const includeCurrents = opts.includeCurrents !== false && opts.providers?.currents !== false;
  const includeGuardian = opts.includeGuardian !== false && opts.providers?.guardian !== false;
  let attempted = 0;
  let succeeded = 0;
  async function attempt(source: string, operation: () => Promise<RssItem[]>): Promise<RssItem[]> {
    attempted++;
    let items: RssItem[];
    try { items = await operation(); }
    catch (error) {
      opts.onSourceResult?.({ source, ok: false, items: 0,
        error: error instanceof ProviderError ? error.message : 'news-feed: unavailable' });
      return [];
    }
    succeeded++;
    opts.onSourceResult?.({ source, ok: true, items: items.length });
    return items;
  }
  const rssPromise = Promise.all(F1_RSS_SOURCES.map((s) => attempt(s.name, () => fetchFeed(s, revalidate, { ...opts, strict: true, cacheTags: [NEWS_CACHE_TAG, RSS_NEWS_CACHE_TAG] }))));

  // Guardian is fetched lazily so the rss-only path stays zero-dep. We
  // import dynamically to avoid a hard cycle if guardian later wants rss
  // types. The await Promise.all races both branches.
  const guardianPromise: Promise<RssItem[]> = (async () => {
    if (!includeGuardian || !process.env['GUARDIAN_API_KEY']) return [];
    return attempt('The Guardian', async () => {
      const { getGuardianF1News, mapGuardianItems } = await import('../guardian');
      const raw = await getGuardianF1News({ ...opts, strict: true, revalidate: Math.max(revalidate, 600) });
      return mapGuardianItems(raw).map(item => ({ ...item, provider: 'guardian' as const }));
    });
  })();

  // NewsAPI runs server-side only. Its client already returns [] on missing
  // key / 429 / 5xx, so we don't need a second try/catch here.
  const newsApiPromise: Promise<RssItem[]> = includeNewsAPI && process.env['NEWSAPI_KEY']
    ? attempt('NewsAPI', () => getNewsAPIF1News({
        ...opts,
        strict: true,
        pageSize: 20,
        revalidate: Math.max(revalidate, 1000),
      })
        .then(mapNewsAPIArticlesToUi)
        .then(uiToRssItems))
    : Promise.resolve([]);

  // NewsData · multi-language + sentiment. 200/day quota → floor to 600s
  // revalidate. Lazy-imported to avoid loading the module when the key is
  // missing or the caller has opted out.
  const newsDataPromise: Promise<RssItem[]> = (async () => {
    if (!includeNewsData) return [];
    if (!process.env['NEWSDATA_API_KEY']) return [];
    return attempt('NewsData', async () => {
      const { getNewsDataF1News, mapNewsDataArticles } = await import('../newsdata');
      const raw = await getNewsDataF1News({
        ...opts,
        strict: true,
        pageSize: 10,
        revalidate: Math.max(revalidate, 600),
      });
      // mapNewsDataArticles returns UiNewsItemExtended which is structurally
      // assignable to RssItem (every NewsData-only field is optional on RssItem).
      return mapNewsDataArticles(raw) as unknown as RssItem[];
    });
  })();

  // Currents · only enabled when its account key is provisioned.
  const currentsPromise: Promise<RssItem[]> = (async () => {
    if (!includeCurrents) return [];
    if (!process.env['CURRENTS_API_KEY']) return [];
    return attempt('Currents', async () => {
      const { getCurrentsF1News, mapCurrentsItems } = await import('../currents');
      const raw = await getCurrentsF1News({ ...opts, strict: true, revalidate: Math.max(revalidate, 600) });
      return mapCurrentsItems(raw).map((it): RssItem => ({ ...it, provider: 'currents' }));
    });
  })();

  const [rssResults, guardianResults, newsApiResults, newsDataResults, currentsResults] = await Promise.all([
    rssPromise,
    guardianPromise,
    newsApiPromise,
    newsDataPromise,
    currentsPromise,
  ]);
  if (opts.strict && attempted > 0 && succeeded === 0) throw new ProviderError('news-feed', 'network');
  // Tag plain-RSS rows with their provider key so the UI can group them.
  const rssTagged = rssResults
    .flat()
    .map((it): RssItem => ({ ...it, provider: 'rss' }));
  const all = [
    ...rssTagged,
    ...guardianResults,
    ...newsApiResults.map((it): RssItem => ({ ...it, provider: 'newsapi' })),
    ...newsDataResults.map((it): RssItem => ({ ...it, provider: 'newsdata' })),
    ...currentsResults,
  ];

  // F1-only news policy (docs/NEWS-POLICY.md): curated feeds may not carry
  // other series or sports; keyword-search rows must come from an allowlisted
  // publisher and name F1. Rows are in priority order (curated RSS first) so
  // the policy keeps curated copies over API copies of the same newsroom.
  const relevant = applyNewsPolicy(all, opts.policyReport);

  // Sort newest-first before dedupe so the kept copy is always the freshest.
  relevant.sort((a, b) => b.pubDateMs - a.pubDateMs);

  const seenTitles = new Set<string>();
  const seenLinks = new Set<string>();
  const deduped: RssItem[] = [];
  for (const item of relevant) {
    const tk = dedupeKey(item.title);
    const lk = linkKey(item.link);
    if (tk && seenTitles.has(tk)) continue;
    if (lk && seenLinks.has(lk)) continue;
    if (tk) seenTitles.add(tk);
    if (lk) seenLinks.add(lk);
    deduped.push(item);
  }
  // Same story, slightly different headline (syndicated copies): keep the
  // first, i.e. the freshest, copy of each story.
  const unique = dropNearDuplicates(deduped);

  const capped = capPerSource(unique, maxPerSource);
  const final = opts.limit ? capped.slice(0, opts.limit) : capped;

  // Enrich here rather than inside fetchFeed. Two reasons:
  //
  //   Coverage — fetchFeed only sees the RSS sources. Guardian, NewsAPI,
  //   NewsData and Currents are merged in above and would never have been
  //   enriched, which is why blank tiles survived the first attempt.
  //
  //   Cost — this runs after dedupe and capPerSource, so it only fetches
  //   articles that actually reach the page. Enriching inside fetchFeed paid
  //   for items that were about to be discarded.
  return opts.enrichImages ? enrichMissingNewsImages(final) : final;
}

/** Fetch one specific source. Used by sections that want a single provider. */
export async function getRssFeed(source: RssSource, opts: ProviderRequestOptions & { limit?: number; revalidate?: number; strict?: boolean; cacheTags?: string[] } = {}): Promise<RssItem[]> {
  const items = await fetchFeed(source, opts.revalidate ?? 300, opts);
  return opts.limit ? items.slice(0, opts.limit) : items;
}
export { isPublicAddress } from './safe-html';
