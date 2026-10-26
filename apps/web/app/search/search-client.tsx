'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Heading, Icon, Label } from '@/components/ds';
import type { SearchItem } from './page';
import { matchingSearchSuggestions } from '@/lib/search-suggestions';
import { createFuzzyIndex, rankSearch } from '@/lib/search-rank';
import { groupSearchResults, hasMark, initialSearchState, searchHref, searchStatus, shownMeta, type SearchKind } from '@/components/search/search-view';
import { filterItemClass } from '@/components/news/FilterRail';

const KIND_LABEL: Record<SearchItem['kind'], string> = { driver: 'Driver', team: 'Constructor', race: 'Race or season' };
const GROUP_LABEL: Record<SearchItem['kind'], string> = { driver: 'Drivers', team: 'Constructors', race: 'Races and seasons' };
const KIND_FILTERS: Array<{ key: SearchKind; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'driver', label: 'Drivers' },
  { key: 'team', label: 'Constructors' },
  { key: 'race', label: 'Races and seasons' },
];
const PAGE = 60;

function highlight(value: string, needle: string): ReactNode {
  const q = needle.trim();
  if (!q) return value;
  const idx = value.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return value;
  return (
    <>
      {value.slice(0, idx)}
      <mark className="bg-transparent text-fg underline decoration-brand-red decoration-2 underline-offset-[0.2em]">{value.slice(idx, idx + q.length)}</mark>
      {value.slice(idx + q.length)}
    </>
  );
}

/**
 * Keep ?q= and ?type= in the address bar so a search can be shared. The
 * history state is left for Next to fill (not passed through): Next then
 * records the new URL in its router, so Back to this page restores the
 * query instead of the URL the page was first opened with (audit
 * D2-CLICK-PATHS-1).
 */
function syncUrl(query: string, kind: SearchKind) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = searchHref(current, query, kind);
  // replaceState keeps typing in place (no round trip, no history spam).
  if (next !== current) window.history.replaceState(null, '', next);
}

/**
 * Leading mark of a row: the real circuit outline, the team colour, or the
 * driver's timing code. With none of those the row has no mark at all; when
 * other rows in its group have one, an empty column keeps the titles aligned.
 */
function RowMark({ item, reserve }: { item: SearchItem; reserve: boolean }) {
  if (item.circuit) {
    return (
      <svg viewBox={item.circuit.viewBox} aria-hidden className="size-11 shrink-0 text-fg-2 transition-colors group-hover/row:text-accent" fill="none">
        <path d={item.circuit.d} stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    );
  }
  if (item.accent) {
    return (
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center">
        <span className="h-9 w-1" style={{ backgroundColor: item.accent }} />
      </span>
    );
  }
  if (item.code) {
    return (
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center font-text text-caption font-[750] tabular-nums tracking-[0.06em] text-fg-3 transition-colors group-hover/row:text-accent">
        {item.code}
      </span>
    );
  }
  return reserve ? <span aria-hidden className="w-11 shrink-0" /> : null;
}

function ResultRow({ item, query, reserve }: { item: SearchItem; query: string; reserve: boolean }) {
  return (
    <li className="min-w-0 shadow-[inset_0_-1px_0_var(--rule)]">
      <Link href={item.href} className="group/row flex min-h-16 items-center gap-3 py-3 pr-1 transition-colors hover:bg-tone-hover focus-visible:bg-tone-hover sm:gap-4 sm:pr-3">
        <RowMark item={item} reserve={reserve} />
        <span className="min-w-0 flex-1">
          <span className="block font-text text-heading-s text-fg [overflow-wrap:anywhere]">{highlight(item.title, query)}</span>
          <span className="mt-0.5 block font-text text-small text-fg-2 [overflow-wrap:anywhere]">{highlight(shownMeta(item), query)}</span>
        </span>
        <Icon name="arrow-right" size={18} className="shrink-0 text-fg-3 transition-transform duration-[var(--duration-base)] group-hover/row:translate-x-1 group-hover/row:text-accent motion-reduce:transition-none" />
      </Link>
    </li>
  );
}

export function SearchClient({
  items,
  initialQuery = '',
  initialKind = 'all',
  suggestions: suggestionCandidates = [],
  season = null,
  label = 'Search drivers, constructors, races and seasons',
}: {
  items: SearchItem[];
  initialQuery?: string;
  /** From ?type= on a shared link. */
  initialKind?: SearchKind;
  /** Live-data terms offered when nothing matches. Only those with exact results are shown. */
  suggestions?: string[];
  /** The season the starting list shows (from lib/season data, never the clock). */
  season?: number | null;
  /** Visible label for the field (the directory pages reuse this client). */
  label?: string;
}) {
  // Start from the address bar, not only the server props: Back to a search
  // replays a cached render whose props still hold the first query.
  const params = useSearchParams();
  const [start] = useState(() => initialSearchState(params, { query: initialQuery, kind: initialKind }, (k) => items.some((i) => i.kind === k)));
  const [q, setQ] = useState(start.query);
  const [visible, setVisible] = useState(PAGE);
  const [kind, setKind] = useState<SearchKind>(start.kind);
  const input = useRef<HTMLInputElement>(null);
  const deferredQ = useDeferredValue(q);
  const query = deferredQ.trim();

  // Debounced so the address bar is not rewritten on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => syncUrl(q, kind), 250);
    return () => window.clearTimeout(timer);
  }, [q, kind]);

  const fuzzyIndex = useMemo(() => createFuzzyIndex(items), [items]);
  const ranking = useMemo(() => rankSearch(items, query, fuzzyIndex), [items, query, fuzzyIndex]);
  // Before anything is typed, start from this season (the grid, the teams, the
  // calendar) when the corpus marks it; a directory without it starts from everything.
  const seasonStart = useMemo(() => items.filter((i) => i.current), [items]);
  const startsWithSeason = !query && seasonStart.length > 0;
  const pool = useMemo(() => (query ? ranking.items : seasonStart.length ? seasonStart : items), [query, ranking, items, seasonStart]);
  const counts = useMemo(() => {
    const c: Record<SearchKind, number> = { all: pool.length, driver: 0, team: 0, race: 0 };
    for (const item of pool) c[item.kind] += 1;
    return c;
  }, [pool]);
  const filtered = useMemo(() => pool.filter((i) => kind === 'all' || i.kind === kind), [pool, kind]);
  const best = query && ranking.mode === 'exact' ? filtered[0] : undefined;
  const groups = useMemo(() => groupSearchResults(best ? filtered.slice(1) : filtered, visible), [filtered, best, visible]);
  const suggestions = useMemo(
    () => matchingSearchSuggestions(suggestionCandidates, (term) => rankSearch(items, term, fuzzyIndex).mode === 'exact'),
    [suggestionCandidates, items, fuzzyIndex],
  );
  const status = searchStatus({ query, total: filtered.length, corpus: items.length, mode: ranking.mode, season: startsWithSeason ? season : null });

  const choose = (term: string) => { setQ(term); setKind('all'); setVisible(PAGE); input.current?.focus(); };

  return (
    <div>
        <form role="search" onSubmit={(e) => e.preventDefault()} className="group/search relative">
          <label htmlFor="apex-search" className="mb-3 block font-text text-small font-[650] text-fg-2">
            {label}
          </label>
          <div className="relative flex items-center shadow-[inset_0_-2px_0_var(--rule-strong)] transition-shadow duration-[var(--duration-fast)] focus-within:shadow-[inset_0_-3px_0_var(--color-brand-red)]">
            <Icon name="search" size={28} className="pointer-events-none shrink-0 text-fg-3 transition-colors group-focus-within/search:text-accent md:size-9" />
            <input
              ref={input}
              id="apex-search"
              type="search"
              value={q}
              onChange={(e) => { setQ(e.target.value); setVisible(PAGE); }}
              onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.preventDefault(); setQ(''); syncUrl('', kind); } }}
              placeholder="Name or year"
              autoComplete="off"
              spellCheck={false}
              autoFocus={!start.query}
              aria-describedby="search-status"
              className="min-w-0 flex-1 bg-transparent py-4 pl-3 pr-2 font-display text-[clamp(1.75rem,0.9rem+3.6vw,3.75rem)] font-[750] leading-[1.1] tracking-[0em] text-fg font-normal-width placeholder:text-fg-3 focus:outline-none focus-visible:outline-none! md:pl-5 [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" onClick={() => { setQ(''); syncUrl('', kind); input.current?.focus(); }} aria-label="Clear the search" className="flex size-11 shrink-0 items-center justify-center text-fg-2 transition-colors hover:bg-tone-hover hover:text-fg">
                <Icon name="close" size={20} />
              </button>
            )}
          </div>
          <p className="mt-3 max-w-[65ch] text-[0.9rem] text-[color:var(--bc-titanium)]">Exact names first, then close spellings. Press Escape to clear.</p>
        </form>

      <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Show results of one type" className="flex min-w-0 flex-wrap gap-x-5 px-1 py-1 shadow-[inset_0_-1px_0_var(--rule)]">
          {KIND_FILTERS.filter((f) => f.key === 'all' || items.some((i) => i.kind === f.key)).map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={kind === f.key}
              onClick={() => { setKind(f.key); setVisible(PAGE); }}
              className={filterItemClass}
            >
              {f.label}
              <span data-count className="bc-mono text-[0.76rem]">{counts[f.key].toLocaleString('en-GB')}</span>
            </button>
          ))}
        </div>
        <p id="search-status" role="status" aria-live="polite" className="font-text text-small text-fg-2">{status}</p>
      </div>

      {query && filtered.length === 0 ? (
        <div className="mt-12 grid gap-8 py-10 shadow-[inset_0_1px_0_var(--rule)] lg:grid-cols-12">
          <div className="lg:col-span-6">
            <Heading level={2} size="heading-l" caps={false}>Nothing matches “{query}”</Heading>
            <p className="mt-3 max-w-[48ch] font-text text-body text-fg-2">
              {kind !== 'all' ? 'Nothing of this type matches. Try all types, a surname, a constructor, a race location or a season year.' : 'Try a surname, a constructor, a race location or a season year.'}
            </p>
          </div>
          <div className="lg:col-span-6">
            {kind !== 'all' && <Button variant="secondary" onClick={() => setKind('all')}>Search all types</Button>}
            {suggestions.length > 0 && (
              <>
                <Label as="p" className="mt-6 block lg:mt-0">Try one of these</Label>
                <div className="mt-3 flex flex-wrap gap-3">
                  {suggestions.map((term) => (
                    <Button key={term} variant="secondary" onClick={() => choose(term)}>{term}</Button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-10" onClickCapture={() => syncUrl(q, kind)}>
          {best && (
            <section aria-labelledby="best-match" className="mb-12">
              <Label as="h2" id="best-match" className="block pb-3">Best match</Label>
              <Link href={best.href} className="group/row tone-raised flex items-center gap-4 p-5 transition-colors hover:bg-tone-hover sm:gap-6 md:p-7">
                {best.circuit ? (
                  <svg viewBox={best.circuit.viewBox} aria-hidden className="size-16 shrink-0 text-fg md:size-24" fill="none">
                    <path d={best.circuit.d} stroke="currentColor" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  </svg>
                ) : best.accent ? (
                  <span aria-hidden className="h-16 w-1.5 shrink-0 md:h-20" style={{ backgroundColor: best.accent }} />
                ) : best.code ? (
                  <span aria-hidden className="shrink-0 font-text text-heading-m font-[750] tabular-nums tracking-[0.04em] text-accent">{best.code}</span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <Label className="block" tone="subtle">{KIND_LABEL[best.kind]}</Label>
                  <span className="mt-1 block font-text text-heading-l text-fg [overflow-wrap:anywhere]">{best.title}</span>
                  <span className="mt-1 block font-text text-body text-fg-2 [overflow-wrap:anywhere]">{shownMeta(best)}</span>
                </span>
                <Icon name="arrow-right" size={24} className="shrink-0 text-accent transition-transform duration-[var(--duration-base)] group-hover/row:translate-x-1 motion-reduce:transition-none" />
              </Link>
            </section>
          )}
          <div className="flex flex-col gap-12">
            {groups.map((g) => {
              const reserve = g.rows.some(hasMark);
              return (
              <section key={g.kind} aria-labelledby={`group-${g.kind}`}>
                <div className="flex items-baseline justify-between gap-6 pb-3 shadow-[inset_0_-2px_0_var(--rule-strong)]">
                  <h2 id={`group-${g.kind}`} className="font-text text-heading-m text-fg">{startsWithSeason && season ? `${GROUP_LABEL[g.kind]} in ${season}` : GROUP_LABEL[g.kind]}</h2>
                  <span className="shrink-0 font-text text-small tabular-nums text-fg-3">{g.total.toLocaleString('en-GB')}</span>
                </div>
                <ul className="grid md:grid-cols-2 md:gap-x-10">
                  {g.rows.map((item) => <ResultRow key={`${item.kind}-${item.slug}`} item={item} query={query} reserve={reserve} />)}
                </ul>
              </section>
              );
            })}
          </div>
          {filtered.length - (best ? 1 : 0) > visible && (
            <Button variant="secondary" size="lg" className="mt-10" onClick={() => setVisible((v) => v + PAGE)}>
              Show {Math.min(PAGE, filtered.length - (best ? 1 : 0) - visible)} more of {(filtered.length - (best ? 1 : 0) - visible).toLocaleString('en-GB')} remaining
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
