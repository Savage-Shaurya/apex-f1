/**
 * Presentation helpers for /search, kept pure so they can be tested without a
 * browser. Ranking itself lives in lib/search-rank.ts.
 */
export type SearchKind = 'all' | 'driver' | 'team' | 'race';

/**
 * Group the visible slice of ranked results by kind, in the order the best
 * result of each kind appears. `total` is the full count of that kind, so a
 * group heading never under-reports when only part of it is shown.
 */
export function groupSearchResults<T extends { kind: Exclude<SearchKind, 'all'> }>(ranked: readonly T[], visible: number): Array<{ kind: T['kind']; rows: T[]; total: number }> {
  const totals = new Map<T['kind'], number>();
  for (const item of ranked) totals.set(item.kind, (totals.get(item.kind) ?? 0) + 1);
  const order: Array<T['kind']> = [];
  const rows = new Map<T['kind'], T[]>();
  for (const item of ranked.slice(0, Math.max(0, visible))) {
    if (!rows.has(item.kind)) { rows.set(item.kind, []); order.push(item.kind); }
    rows.get(item.kind)!.push(item);
  }
  return order.map((kind) => ({ kind, rows: rows.get(kind)!, total: totals.get(kind) ?? 0 }));
}

/** The one-line status read to screen readers and shown beside the filters. */
export function searchStatus({ query, total, corpus, mode, season }: { query: string; total: number; corpus: number; mode: 'all' | 'exact' | 'fuzzy'; season: number | null }): string {
  const n = (v: number) => v.toLocaleString('en-GB');
  if (!query) return season ? `Showing the ${season} season. Type to search all ${n(corpus)} records.` : `Showing all ${n(corpus)} records. Type to narrow them down.`;
  if (total === 0) return `No results for “${query}”.`;
  const base = `${n(total)} ${total === 1 ? 'result' : 'results'} for “${query}”`;
  return mode === 'fuzzy' ? `${base}. No exact match, so these are the closest spellings.` : `${base}, exact matches first.`;
}

type Markable = { circuit?: unknown; accent?: string; code?: string; meta: string };

/** Whether a row has a meaningful leading mark (circuit, team colour or timing code), never a neutral placeholder. */
export function hasMark(item: Markable): boolean {
  return Boolean(item.circuit || item.accent || item.code);
}

/** The meta line as shown: the timing code is dropped when it already leads the row as its mark. */
export function shownMeta(item: Markable): string {
  const codeIsMark = !item.circuit && !item.accent && item.code;
  return codeIsMark && item.meta.startsWith(`${item.code} · `) ? item.meta.slice(item.code!.length + 3) : item.meta;
}

const KINDS: ReadonlyArray<Exclude<SearchKind, 'all'>> = ['driver', 'team', 'race'];

/**
 * The query and type a search starts from. The address bar wins over the
 * server props: on Back, Next replays the cached render of the page (props
 * from the first visit), while the URL already carries the reader's last
 * query. Once there is an address bar, a missing ?q= means the reader
 * cleared the search (the first render already put any query in the URL),
 * so the stale prop never comes back (R3-CLICK-3). A type the corpus does
 * not contain falls back to all.
 */
export function initialSearchState(
  params: { get(name: string): string | null } | null,
  fallback: { query: string; kind: SearchKind },
  hasKind: (kind: Exclude<SearchKind, 'all'>) => boolean,
): { query: string; kind: SearchKind } {
  const query = params ? (params.get('q') ?? '') : fallback.query;
  const wanted = params ? (params.get('type') ?? 'all') : fallback.kind;
  const kind = (KINDS as readonly string[]).includes(wanted) && hasKind(wanted as Exclude<SearchKind, 'all'>) ? (wanted as SearchKind) : 'all';
  return { query, kind };
}

/** The shareable address for a query and type, keeping every other part of `current` (path, other params, hash). */
export function searchHref(current: string, query: string, kind: SearchKind): string {
  const url = new URL(current, 'http://apex.local');
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set('q', trimmed); else url.searchParams.delete('q');
  if (kind !== 'all') url.searchParams.set('type', kind); else url.searchParams.delete('type');
  return `${url.pathname}${url.search}${url.hash}`;
}
