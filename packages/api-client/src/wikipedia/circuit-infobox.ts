/**
 * Circuit layouts and lap lengths from English Wikipedia circuit infoboxes.
 *
 * Jolpica's `Circuit.url` points at the circuit article. Its infobox lists
 * each layout with the years it was used and its length, e.g.
 *
 *   |layout     = Grand Prix Circuit (2023–present)
 *   |length_km  = 5.419
 *   |layout4    = Original Grand Prix Circuit (2004–2022)
 *   |length4_km = 5.380
 *
 * Race-only articles (Infobox F1 race) carry `circuit_length_km` and
 * `first_held` instead. Lengths are only ever read from these fields; a
 * season with no matching layout has no published length.
 */
import { ProviderError, failOr, isRecord, requestJson, type ProviderRequestOptions } from '../transport';
import { APEX_USER_AGENT } from '../user-agent';

const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = APEX_USER_AGENT;
/** MediaWiki's per-request title limit for anonymous clients. */
const MAX_TITLES = 50;
/** Layout facts change rarely; read each article at most every 30 days. */
export const CIRCUIT_INFOBOX_REVALIDATE = 30 * 86_400;

export interface CircuitLayoutRange { from: number; to: number | null }
export interface CircuitLayoutSegment { name: string; ranges: CircuitLayoutRange[]; excluded: boolean }
export interface CircuitLayout {
  /** 1-based infobox order; layout 1 is the article's current/primary layout. */
  index: number;
  name: string;
  lengthKm: number | null;
  segments: CircuitLayoutSegment[];
}

export interface CircuitSeasonFacts {
  lengthKm: number | null;
  layoutName: string | null;
  /** True when the season ran on the infobox's primary (today's) layout. */
  primaryLayout: boolean;
}

/** Configurations that are not the Formula 1 / Grand Prix track. */
const NON_GP_LAYOUT = /formula\s*e\b|motorcycle|moto\s*gp|\bmoto\b|superbike|\bbike\b|nascar|indycar|\boval\b|\bnational\b|\bclub\b|\bshort\b|kart|rallycross|drag\b|drift|junior|school|\bnorth\b|\bsouth\b|\beast\b|\bwest\b|corkscrew|inner|oasis|paddock|endurance|outer|truck/i;

function stripTemplates(text: string): string {
  let out = text;
  for (let pass = 0; pass < 12; pass++) {
    const next = out.replace(/\{\{[^{}]*\}\}/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Wikitext fragment to plain text; `{{convert|5.419|km}}` keeps its number. */
export function cleanWikiValue(raw: string): string {
  let text = raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?(?:<\/ref>|$)/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\{\{\s*convert\s*\|\s*([\d.]+)\s*\|[^{}]*\}\}/gi, '$1');
  text = stripTemplates(text)
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function parseRanges(content: string): CircuitLayoutRange[] {
  const ranges: CircuitLayoutRange[] = [];
  for (const part of content.split(/[,;]|\band\b/)) {
    const span = part.match(/(\d{4})\s*[–—-]\s*(?:[A-Za-z]+\.?\s+)?(\d{4}|present)?/i);
    if (span) {
      const from = Number(span[1]);
      const to = span[2] && /^\d{4}$/.test(span[2]) ? Number(span[2]) : null;
      if (to === null || to >= from) ranges.push({ from, to });
      continue;
    }
    const single = part.match(/(\d{4})/);
    if (single) ranges.push({ from: Number(single[1]), to: Number(single[1]) });
  }
  return ranges.filter((r) => r.from >= 1890 && r.from <= 9999);
}

function parseSegments(name: string): CircuitLayoutSegment[] {
  const lead = name.split('(')[0]!.trim();
  const segments: CircuitLayoutSegment[] = [];
  const pattern = /([^()&]*?)\s*\(([^()]*\d{4}[^()]*)\)/g;
  for (const match of name.matchAll(pattern)) {
    const label = match[1]!.replace(/^[\s&,/]+|[\s&,/]+$/g, '').trim() || lead;
    const ranges = parseRanges(match[2]!);
    if (ranges.length) segments.push({ name: label, ranges, excluded: NON_GP_LAYOUT.test(label) });
  }
  return segments;
}

function parseLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = cleanWikiValue(raw).match(/^\s*(\d{1,2}(?:\.\d{1,4})?)/);
  if (!match) return null;
  const km = Number(match[1]);
  return Number.isFinite(km) && km >= 0.5 && km <= 30 ? km : null;
}

/** Top-level `| key = value` fields of the article's lead section. */
function fields(wikitext: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of wikitext.split('\n')) {
    const match = line.match(/^\s*\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && !out.has(match[1]!.toLowerCase())) out.set(match[1]!.toLowerCase(), match[2]!);
  }
  return out;
}

/** Parse every layout the infobox lists, in infobox order. */
export function parseCircuitInfobox(wikitext: string): CircuitLayout[] {
  const f = fields(wikitext);
  const layouts: CircuitLayout[] = [];
  for (let index = 1; index <= 30; index++) {
    const rawName = f.get(index === 1 ? 'layout' : `layout${index}`);
    if (rawName === undefined) continue;
    const rawLength = index === 1 ? f.get('length_km') : f.get(`length${index}_km`) ?? f.get(`length_km${index}`);
    const name = cleanWikiValue(rawName);
    layouts.push({ index, name, lengthKm: parseLength(rawLength), segments: parseSegments(name) });
  }
  if (layouts.length) return layouts;
  // Race articles (Infobox F1 race): one current circuit length since first_held.
  const raceLength = parseLength(f.get('circuit_length_km'));
  const first = cleanWikiValue(f.get('first_held') ?? '').match(/(\d{4})/);
  if (raceLength !== null && first) {
    const from = Number(first[1]);
    const last = cleanWikiValue(f.get('last_held') ?? '').match(/(\d{4})/);
    const to = last ? Number(last[1]) : null;
    const name = `Circuit (${from}–${to ?? 'present'})`;
    return [{ index: 1, name, lengthKm: raceLength, segments: [{ name: 'Circuit', ranges: [{ from, to }], excluded: false }] }];
  }
  if (raceLength !== null) return [{ index: 1, name: 'Circuit', lengthKm: raceLength, segments: [] }];
  return [];
}

const covers = (range: CircuitLayoutRange, season: number) => season >= range.from && (range.to === null || season <= range.to);
const GRAND_PRIX_NAME = /grand\s*prix|\bgp\b|formula\s*(?:one|1)\b|\bf1\b/i;

/**
 * Which layout a season ran on. Layouts are matched by their year ranges,
 * skipping configurations that are not the Grand Prix track (Formula E,
 * motorcycle, national, club...). Layouts named "Grand Prix" win over other
 * dated configurations. If several candidates remain, the primary layout wins;
 * otherwise differing lengths are ambiguous and nothing is claimed. For the
 * current or a future season with no dated match, the infobox's primary layout
 * is today's layout.
 */
export function circuitFactsForSeason(layouts: readonly CircuitLayout[], season: number, currentYear: number): CircuitSeasonFacts {
  const none: CircuitSeasonFacts = { lengthKm: null, layoutName: null, primaryLayout: false };
  if (!layouts.length || !Number.isInteger(season)) return none;
  const primary = layouts[0]!;
  const covering = (named: boolean) => layouts.filter((layout) => layout.segments.some((s) =>
    !s.excluded && GRAND_PRIX_NAME.test(s.name) === named && s.ranges.some((r) => covers(r, season))));
  const tier = [covering(true), covering(false)].find((list) => list.length > 0) ?? [];
  let chosen: CircuitLayout | null = null;
  if (tier.length === 1) chosen = tier[0]!;
  else if (tier.length > 1) {
    if (tier.includes(primary)) chosen = primary;
    else {
      const lengths = new Set(tier.map((layout) => layout.lengthKm).filter((km): km is number => km !== null));
      if (lengths.size > 1) return none;
      chosen = tier.find((layout) => layout.lengthKm !== null) ?? tier[0]!;
    }
  } else if (season >= currentYear && (primary.segments.length === 0 || primary.segments.some((s) => !s.excluded))) {
    chosen = primary;
  }
  if (!chosen) return none;
  return { lengthKm: chosen.lengthKm, layoutName: chosen.name, primaryLayout: chosen.index === primary.index };
}

/** Article title from an en.wikipedia.org URL; null for anything else. */
export function wikipediaTitleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'en.wikipedia.org' && parsed.hostname !== 'en.m.wikipedia.org') return null;
    const match = parsed.pathname.match(/^\/wiki\/(.+)$/);
    if (!match) return null;
    const title = decodeURIComponent(match[1]!).replace(/_/g, ' ').trim();
    return title && title.length <= 255 && !/[#<>[\]{}|]/.test(title) ? title : null;
  } catch {
    return null;
  }
}

interface QueryPage { title?: unknown; missing?: unknown; revisions?: Array<{ slots?: { main?: { content?: unknown } } }> }

/**
 * Lead-section wikitext for several circuit articles in one MediaWiki call
 * per 50 titles, keyed by the input URL. Missing articles map to `[]`.
 * Transport failures throw (strict) or yield an empty map.
 */
export async function getCircuitInfoboxes(
  urls: readonly string[],
  opts: ProviderRequestOptions & { revalidate?: number; strict?: boolean } = {},
): Promise<Map<string, CircuitLayout[]>> {
  const result = new Map<string, CircuitLayout[]>();
  const byTitle = new Map<string, string[]>();
  for (const url of urls) {
    const title = wikipediaTitleFromUrl(url);
    if (!title) { result.set(url, []); continue; }
    byTitle.set(title, [...(byTitle.get(title) ?? []), url]);
  }
  const titles = [...byTitle.keys()].sort();
  try {
    for (let offset = 0; offset < titles.length; offset += MAX_TITLES) {
      const chunk = titles.slice(offset, offset + MAX_TITLES);
      const url = new URL(API);
      for (const [key, value] of Object.entries({
        action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0',
        titles: chunk.join('|'), redirects: '1', format: 'json', formatversion: '2', origin: '*',
      })) url.searchParams.set(key, value);
      const raw = await requestJson<unknown>('wikipedia', url, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        next: { revalidate: opts.revalidate ?? CIRCUIT_INFOBOX_REVALIDATE },
      } as RequestInit, { timeoutMs: 8000, maxBytes: 4_000_000, ...opts });
      if (!isRecord(raw) || !isRecord(raw.query) || !Array.isArray(raw.query.pages)) throw new ProviderError('wikipedia', 'invalid-response');
      // Map each returned page back through MediaWiki's normalisation and redirects.
      const back = new Map<string, string>();
      for (const list of [raw.query.normalized, raw.query.redirects]) {
        if (!Array.isArray(list)) continue;
        for (const entry of list) if (isRecord(entry) && typeof entry.from === 'string' && typeof entry.to === 'string') back.set(entry.to, entry.from);
      }
      const original = (title: string) => {
        let current = title;
        for (let hops = 0; hops < 3 && !byTitle.has(current) && back.has(current); hops++) current = back.get(current)!;
        return current;
      };
      for (const page of raw.query.pages as QueryPage[]) {
        if (typeof page.title !== 'string') continue;
        const content = page.revisions?.[0]?.slots?.main?.content;
        const layouts = typeof content === 'string' ? parseCircuitInfobox(content) : [];
        for (const input of byTitle.get(original(page.title)) ?? []) result.set(input, layouts);
      }
    }
    return result;
  } catch (error) {
    return failOr('wikipedia', error, opts.strict, new Map<string, CircuitLayout[]>());
  }
}
