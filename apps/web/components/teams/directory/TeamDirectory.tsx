'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { cn } from '@apex/ui';
import { searchKey } from '@/components/drivers/people';
import { directoryQuery, readShortcutPreference, shouldFocusSearch, writeShortcutPreference } from './shortcut';

export interface TeamDirectoryItem {
  slug: string;
  href: string;
  name: string;
  sortName: string;
  letter: string;
  nationality: string | null;
  /** Team colour when the constructor is on this season's grid. */
  color: string | null;
  /** Constructors' titles (engine-named entries folded into their team). */
  titles: number;
}

type Show = 'all' | 'grid' | 'champions';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SHOWS: Array<{ id: Show; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'grid', label: 'On the grid' },
  { id: 'champions', label: 'Champions' },
];

// The reader's choice for the "/" shortcut, remembered per browser. Blocked storage: on, and the switch still works for the visit.
const PREF_EVENT = 'apex:directory-slash';
let memo: boolean | null = null;
function safeStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function readPreference(): boolean {
  if (memo === null) memo = readShortcutPreference(safeStorage());
  return memo;
}
function subscribePreference(changed: () => void) {
  const on = (e: Event) => { if (e.type === 'storage') memo = null; changed(); };
  window.addEventListener(PREF_EVENT, on);
  window.addEventListener('storage', on);
  return () => { window.removeEventListener(PREF_EVENT, on); window.removeEventListener('storage', on); };
}

const readShow = (v: string | null, titlesKnown: boolean): Show => (v === 'grid' || (v === 'champions' && titlesKnown) ? v : 'all');

/**
 * Every constructor, filed A to Z. Type to filter (accents and punctuation
 * ignored, every word must match), narrow to the current grid or to
 * champions, pick a letter or a nationality. The state lives in the address
 * bar without a navigation, so a search can be shared, and a cleared search
 * leaves nothing behind for Back to restore (R3-CLICK-3: state is read from
 * the URL only; a missing ?q= is an empty search).
 *
 * "/" jumps to the search field only when nothing editable has focus, and a
 * visible switch turns it off for good (WCAG 2.1.4; R3-REG-5, R3-CLICK-5).
 */
export function TeamDirectory({ items, season, titlesKnown }: { items: TeamDirectoryItem[]; season: number | null; titlesKnown: boolean }) {
  const inputId = useId();
  const natId = useId();
  const switchId = useId();
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get('q') ?? '');
  const [letter, setLetter] = useState<string | null>(() => {
    const l = params.get('letter')?.trim().toUpperCase() ?? '';
    return LETTERS.includes(l) ? l : null;
  });
  const [nationality, setNationality] = useState(() => params.get('nationality')?.trim() ?? '');
  const [show, setShow] = useState<Show>(() => readShow(params.get('show'), titlesKnown));
  const slash = useSyncExternalStore(subscribePreference, readPreference, () => true);
  const input = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);

  const keyed = useMemo(() => items.map((it) => ({ ...it, key: searchKey(`${it.name} ${it.nationality ?? ''}`) })), [items]);
  const nationalities = useMemo(() => Array.from(new Set(items.map((i) => i.nationality).filter((n): n is string => Boolean(n)))).sort(), [items]);
  const activeNationality = nationalities.includes(nationality) ? nationality : '';
  const counts = useMemo(() => ({ all: items.length, grid: items.filter((i) => i.color).length, champions: items.filter((i) => i.titles > 0).length }), [items]);

  const base = useMemo(() => keyed.filter((it) => (show === 'grid' ? it.color !== null : show === 'champions' ? it.titles > 0 : true)), [keyed, show]);
  const letterCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of base) m.set(it.letter, (m.get(it.letter) ?? 0) + 1);
    return m;
  }, [base]);
  const filtered = useMemo(() => {
    const words = searchKey(deferred).split(' ').filter(Boolean);
    return base.filter((it) => (!letter || it.letter === letter) && (!activeNationality || it.nationality === activeNationality) && words.every((w) => it.key.includes(w)));
  }, [base, deferred, letter, activeNationality]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const it of filtered) m.set(it.letter, [...(m.get(it.letter) ?? []), it]);
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Address bar mirrors the state (replaceState: no history entry, nothing to resurrect on Back).
  useEffect(() => {
    const url = new URL(window.location.href);
    const next = directoryQuery(url.searchParams, { q: deferred.trim(), letter: letter ?? '', nationality: activeNationality, show: show === 'all' ? '' : show });
    if (next === url.search) return;
    url.search = next;
    window.history.replaceState(window.history.state, '', url);
  }, [deferred, letter, activeNationality, show]);


  useEffect(() => {
    if (!slash) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const focus = el && el !== document.body
        ? { tagName: el.tagName, isContentEditable: el.isContentEditable, role: el.getAttribute('role'), inDialog: Boolean(el.closest('dialog,[role="dialog"],[aria-modal="true"]')) }
        : document.querySelector('dialog[open],[aria-modal="true"]') ? { tagName: 'BODY', isContentEditable: false, role: null, inDialog: true } : null;
      if (!shouldFocusSearch(e, focus, true)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slash]);

  const toggleSlash = () => {
    writeShortcutPreference(safeStorage(), !slash);
    memo = !slash;
    window.dispatchEvent(new Event(PREF_EVENT));
  };
  const clear = () => { setQuery(''); setLetter(null); setNationality(''); setShow('all'); input.current?.focus(); };
  const filteredBy = [deferred.trim() && `“${deferred.trim()}”`, letter && `letter ${letter}`, activeNationality, show === 'grid' ? `the ${season ?? 'current'} grid` : show === 'champions' ? 'champions' : ''].filter(Boolean).join(', ');

  return (
    <div>
      <form role="search" action="" method="get" onSubmit={(e) => e.preventDefault()} className="grid gap-x-8 gap-y-6 md:grid-cols-[minmax(0,1fr)_15rem] md:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={inputId} className="bc-label text-[color:var(--bc-silver)]">Search constructors</label>
          <div className="relative">
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-0 top-1/2 h-6 w-6 -translate-y-1/2 text-[color:var(--bc-titanium)]" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" strokeLinecap="round" /></svg>
            <input
              ref={input}
              id={inputId}
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }}
              placeholder="Name or nationality"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${switchId}-hint`}
              className="min-h-16 w-full bg-transparent py-3 pl-10 pr-2 text-[clamp(1.25rem,2.4vw,1.75rem)] font-semibold tracking-[0.005em] text-[color:var(--bc-white)] shadow-[inset_0_-1px_0_var(--bc-rule-strong)] transition-shadow duration-200 placeholder:text-[color:var(--bc-titanium)] focus:shadow-[inset_0_-3px_0_var(--bc-red)] focus:outline-none"
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={natId} className="bc-label text-[color:var(--bc-silver)]">Nationality</label>
          <span className="relative block">
            <select id={natId} value={activeNationality} onChange={(e) => setNationality(e.target.value)} className="min-h-12 w-full appearance-none rounded-none bg-transparent pr-8 text-[1rem] text-[color:var(--bc-white)] shadow-[inset_0_-1px_0_var(--bc-rule-strong)] focus:shadow-[inset_0_-3px_0_var(--bc-red)] focus:outline-none [&>option]:bg-[#111114]">
              <option value="">All nationalities</option>
              {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-[color:var(--bc-silver)]" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {SHOWS.filter((s) => (s.id !== 'champions' || titlesKnown) && (s.id !== 'grid' || counts.grid > 0)).map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={show === s.id}
              onClick={() => { setShow(s.id); setLetter(null); }}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[0.88rem] font-semibold transition-colors',
                show === s.id ? 'bg-[color:var(--bc-white)] text-[color:var(--bc-night)]' : 'text-[color:var(--bc-silver)] ring-1 ring-white/20 hover:text-white hover:ring-white/50',
              )}
            >
              {s.id === 'grid' && season ? `${season} grid` : s.label}
              <span className="bc-mono text-[0.78rem] opacity-80">{counts[s.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            id={switchId}
            type="button"
            role="switch"
            aria-checked={slash}
            onClick={toggleSlash}
            className="group inline-flex min-h-11 items-center gap-3 text-[0.85rem] text-[color:var(--bc-silver)] hover:text-white"
          >
            <span aria-hidden className={cn('relative inline-block h-6 w-10 rounded-full ring-1 transition-colors', slash ? 'bg-white/90 ring-white/90' : 'bg-transparent ring-white/30')}>
              <span className={cn('absolute top-1 h-4 w-4 rounded-full transition-transform duration-200 motion-reduce:transition-none', slash ? 'left-1 translate-x-4 bg-[color:var(--bc-night)]' : 'left-1 bg-[color:var(--bc-silver)]')} />
            </span>
            <span>Shortcut <kbd className="bc-mono rounded border border-white/25 px-1.5 py-0.5 text-[0.8rem] text-[color:var(--bc-white)]">/</kbd> to search</span>
          </button>
          <span id={`${switchId}-hint`} className="sr-only">{slash ? 'Press slash anywhere outside a text field to jump to this search. The shortcut can be turned off with the switch next to it.' : ''}</span>
        </div>
      </div>

      <nav aria-label="Filter by letter" className="mt-6 border-b border-[color:var(--bc-rule)]">
        <ul className="-mx-1 flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <li>
            <button type="button" aria-pressed={letter === null} onClick={() => setLetter(null)} className={cn('relative min-h-11 min-w-11 px-3 text-[0.9rem] font-semibold transition-colors', letter === null ? 'text-white after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-silver)] hover:text-white')}>All</button>
          </li>
          {LETTERS.map((l) => {
            const n = letterCounts.get(l) ?? 0;
            return (
              <li key={l}>
                <button
                  type="button"
                  disabled={n === 0}
                  aria-pressed={letter === l}
                  aria-label={`${l}, ${n} ${n === 1 ? 'constructor' : 'constructors'}`}
                  onClick={() => setLetter(letter === l ? null : l)}
                  className={cn('bc-mono relative min-h-11 min-w-11 text-[0.92rem] transition-colors disabled:cursor-default disabled:text-[color:var(--bc-graphite)]', letter === l ? 'text-white after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-silver)] enabled:hover:text-white')}
                >
                  {l}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <p aria-live="polite" className="mt-5 text-[0.9rem] text-[color:var(--bc-silver)]">
        {filtered.length === items.length ? `${items.length} constructors` : `${filtered.length} of ${items.length} constructors${filteredBy ? `, filtered by ${filteredBy}` : ''}`}
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-5 py-14">
          <p className="bc-wide text-[clamp(1.4rem,3vw,2.2rem)] text-white">No constructor matches {filteredBy || 'these filters'}</p>
          <p className="max-w-[56ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">Try part of a name, or a spelling without accents. Engine-named entries are listed under their full name (Lotus-Climax, Cooper-Maserati).</p>
          <button type="button" onClick={clear} className="inline-flex min-h-11 items-center rounded-full px-5 text-[0.9rem] font-medium text-white ring-1 ring-white/30 hover:ring-white/60">Clear the search</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col">
          {groups.map(([l, rows]) => (
            <section key={l} aria-labelledby={`${inputId}-${l}`} className="grid gap-x-8 border-t border-[color:var(--bc-rule-strong)] py-6 md:grid-cols-[5.5rem_minmax(0,1fr)]">
              <h2 id={`${inputId}-${l}`} className="bc-display text-[2.6rem] text-[color:var(--bc-white)] md:sticky md:top-[calc(var(--shell-h,64px)+1rem)] md:self-start">{l}</h2>
              <ul className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 md:mt-0 xl:grid-cols-3">
                {rows.map((it) => (
                  <li key={it.slug} className="border-b border-[color:var(--bc-rule)]">
                    {/* Hundreds of rows: no viewport prefetch (each would render a team page and spend provider budget); the page loads on tap. */}
                    <Link href={it.href} prefetch={false} className="group/row flex min-h-14 items-center justify-between gap-4 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        {it.color ? <span aria-hidden className="h-5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: it.color } as CSSProperties} /> : <span aria-hidden className="h-5 w-[3px] shrink-0" />}
                        <span className="min-w-0 break-words text-[1rem] font-semibold text-[color:var(--bc-white)] underline-offset-4 group-hover/row:underline">{it.name}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end text-right">
                        {it.nationality && <span className="text-[0.82rem] text-[color:var(--bc-titanium)]">{it.nationality}</span>}
                        {(it.titles > 0 || it.color) && (
                          <span className="bc-label mt-0.5 text-[0.62rem] text-[color:var(--bc-silver)]">
                            {[it.color ? `${season ?? 'Current'} grid` : '', it.titles > 0 ? `${it.titles} ${it.titles === 1 ? 'title' : 'titles'}` : ''].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
