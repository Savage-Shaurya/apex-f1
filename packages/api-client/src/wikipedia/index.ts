/**
 * Wikipedia REST API client.
 * No auth, no rate-limit, free.
 * Docs: https://en.wikipedia.org/api/rest_v1/
 *
 * Use this in preference to Wikidata SPARQL when you need:
 *   - a thumbnail image for an article (driver, team, circuit)
 *   - a short intro paragraph
 *   - canonical title + URL
 *
 * The summary endpoint always returns a deterministic shape for a given
 * page title, which makes it more reliable than SPARQL queries that
 * require exact-label matching.
 */


/** Cap upstream latency so a stalled provider cannot pin a serverless function. */
import { requestJson, type ProviderRequestOptions } from '../transport';
import { APEX_USER_AGENT } from '../user-agent';
const REQUEST_TIMEOUT_MS = 8000;
const REST_BASE = 'https://en.wikipedia.org/api/rest_v1';

export interface WikipediaSummary {
  title: string;
  description?: string;
  extract: string;
  thumbnailUrl?: string;
  originalImageUrl?: string;
  pageUrl: string;
  pageId?: number;
  /** Wikidata item id, e.g. "Q9673". Used to enrich with structured facts. */
  wikidataId?: string;
}

interface RawSummary {
  type?: string;
  title: string;
  displaytitle?: string;
  description?: string;
  extract?: string;
  pageid?: number;
  /** Wikidata item id, e.g. "Q9673". Used to query Wikidata by id for structured facts. */
  wikibase_item?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source: string; width: number; height: number };
  originalimage?: { source: string; width: number; height: number };
}

/**
 * Pull title from a Wikipedia URL.
 *   http://en.wikipedia.org/wiki/Max_Verstappen  → Max_Verstappen
 *   https://en.wikipedia.org/wiki/Fernando_Alonso → Fernando_Alonso
 */
export function titleFromWikiUrl(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/wiki\/(.+)$/);
    if (m && m[1]) return decodeURIComponent(m[1]);
  } catch {
    /* fall through */
  }
  return url;
}

/**
 * Fetch the page summary for a given page title.
 *
 * Returns null when:
 *   - The article does not exist (404)
 *   - The network call fails
 *
 * Default cache: 24h. Driver pages move slowly enough that the saving on
 * upstream load matters more than a fresh thumb.
 */
export async function getWikipediaSummary(
  pageTitle: string,
  opts: ProviderRequestOptions & { revalidate?: number } = {},
): Promise<WikipediaSummary | null> {
  if (!pageTitle) return null;
  const encoded = encodeURIComponent(pageTitle.replace(/ /g, '_'));
  const url = `${REST_BASE}/page/summary/${encoded}`;
  try {
    const raw = await requestJson<RawSummary>('wikipedia', url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': APEX_USER_AGENT,
      },
      next: opts.revalidate !== undefined ? { revalidate: opts.revalidate } : { revalidate: 86_400 },
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, ...opts });
    if (!raw || typeof raw.title !== 'string' || (raw.extract !== undefined && typeof raw.extract !== 'string')) return null;
    return {
      title: raw.title,
      description: raw.description,
      extract: raw.extract ?? '',
      thumbnailUrl: raw.thumbnail?.source,
      originalImageUrl: raw.originalimage?.source,
      pageUrl: raw.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encoded}`,
      pageId: raw.pageid,
      wikidataId: raw.wikibase_item,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wikidata entity lookup BY ID (P-properties on a Q-id are reliable, unlike
// the SPARQL exact-label match which fails on accented/middle-named drivers).
// ─────────────────────────────────────────────────────────────────────────────

export interface WikidataDriverFacts {
  qid: string;
  /** ISO date string e.g. "1997-09-30". */
  dob?: string;
  /** Place of birth · English label. */
  placeOfBirth?: string;
  /** Height in meters, e.g. 1.81. */
  heightM?: number;
  /** Wikimedia Commons "Special:FilePath" URL for the main image (P18). */
  imageUrl?: string;
  /** Country of citizenship · English label. */
  citizenship?: string;
}

interface WikidataEntitiesResponse {
  entities?: Record<
    string,
    {
      claims?: Record<
        string,
        Array<{
          mainsnak?: {
            datavalue?: {
              type?: string;
              value?:
                | string
                | { time?: string; id?: string; amount?: string }
                | Record<string, unknown>;
            };
          };
        }>
      >;
    }
  >;
}

interface WbGetEntitiesResponse {
  entities?: Record<string, { labels?: Record<string, { value: string }> }>;
}

/**
 * Fetch structured facts for a driver by their Wikidata Q-id.
 *
 * Why this is more reliable than the label-match SPARQL we previously used:
 *   - The Q-id comes from Wikipedia's wikibase_item field · a 1:1 mapping
 *     baked into the article, never wrong.
 *   - We query Wikidata's wbgetentities REST endpoint (faster than SPARQL,
 *     no syntax) for the P569 (date of birth), P19 (place of birth), and
 *     P2048 (height) properties + P18 (image).
 *   - Two-step: first claims, then resolve place-of-birth Q-id to an English
 *     label via wbgetentities again.
 */
export async function getDriverFactsByQid(
  qid: string,
  opts: { revalidate?: number } = {},
): Promise<WikidataDriverFacts | null> {
  if (!qid || !qid.startsWith('Q')) return null;
  const revalidate = opts.revalidate ?? 86_400;
  const props = 'P569|P19|P2048|P18|P27';
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&languages=en`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': APEX_USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      next: { revalidate },
    } as RequestInit);
    if (!res.ok) return null;
    const json = (await res.json()) as WikidataEntitiesResponse;
    const entity = json.entities?.[qid];
    if (!entity?.claims) return { qid };

    const claims = entity.claims;
    const facts: WikidataDriverFacts = { qid };

    // P569 · date of birth
    const dobClaim = claims['P569']?.[0]?.mainsnak?.datavalue?.value;
    if (dobClaim && typeof dobClaim === 'object' && 'time' in dobClaim) {
      const t = (dobClaim as { time?: string }).time;
      if (t) {
        // "+1985-01-07T00:00:00Z" -> "1985-01-07"
        const m = t.match(/^\+?(\d{4}-\d{2}-\d{2})/);
        if (m) facts.dob = m[1];
      }
    }

    // P2048 · height. Wikidata stores it inconsistently per entry · some
    // use meters (1.81), some use centimeters (181), and the unit field is
    // unreliable. Normalize: anything > 3 is treated as cm, < 3 as m.
    const heightClaim = claims['P2048']?.[0]?.mainsnak?.datavalue?.value;
    if (heightClaim && typeof heightClaim === 'object' && 'amount' in heightClaim) {
      const amount = (heightClaim as { amount?: string }).amount;
      const n = amount ? Number(amount) : NaN;
      if (Number.isFinite(n) && n > 0) {
        facts.heightM = n > 3 ? n / 100 : n;
      }
    }

    // P18 · image
    const imgClaim = claims['P18']?.[0]?.mainsnak?.datavalue?.value;
    if (typeof imgClaim === 'string' && imgClaim) {
      facts.imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imgClaim.replace(/ /g, '_'))}`;
    }

    // P19 · place of birth (Q-id) + P27 citizenship (Q-id), resolve labels in a second call
    const pobClaim = claims['P19']?.[0]?.mainsnak?.datavalue?.value;
    const cizClaim = claims['P27']?.[0]?.mainsnak?.datavalue?.value;
    const pobId =
      pobClaim && typeof pobClaim === 'object' && 'id' in pobClaim
        ? (pobClaim as { id?: string }).id
        : undefined;
    const cizId =
      cizClaim && typeof cizClaim === 'object' && 'id' in cizClaim
        ? (cizClaim as { id?: string }).id
        : undefined;

    if (pobId || cizId) {
      const ids = [pobId, cizId].filter(Boolean).join('|');
      const labelUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels&languages=en&format=json`;
      try {
        const r2 = await fetch(labelUrl, {
          headers: {
            Accept: 'application/json',
            'User-Agent': APEX_USER_AGENT,
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          next: { revalidate: 7 * 86_400 },
        } as RequestInit);
        if (r2.ok) {
          const j2 = (await r2.json()) as WbGetEntitiesResponse;
          if (pobId && j2.entities?.[pobId]?.labels?.['en']?.value) {
            facts.placeOfBirth = j2.entities[pobId].labels!['en']!.value;
          }
          if (cizId && j2.entities?.[cizId]?.labels?.['en']?.value) {
            facts.citizenship = j2.entities[cizId].labels!['en']!.value;
          }
        }
      } catch {
        /* place label failure · fact already partial, return what we have */
      }
    }

    return facts;
  } catch {
    return null;
  }
}


/** Resolve a Wikipedia summary directly from a wiki URL. */
export async function getWikipediaSummaryByUrl(
  wikiUrl: string,
  opts: ProviderRequestOptions & { revalidate?: number } = {},
): Promise<WikipediaSummary | null> {
  const title = titleFromWikiUrl(wikiUrl);
  return getWikipediaSummary(title, opts);
}

export * from './circuit-infobox';
