'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '@apex/ui';
import '@/components/brand-c/brand-c.css';
import './carbon/drivers.css';
import { Icon } from '@/components/ds';
import { directorySearch, searchKey } from './people';
import { initialDirectoryQuery, slashShortcutFocuses } from './directory-keys';

export interface DirectoryItem {
  slug: string;
  href: string;
  name: string;
  /** Sorting and index key (family name for drivers). */
  sortName: string;
  letter: string;
  nationality: string | null;
  /** Optional honour shown beside the name, e.g. "3 world titles" (real data only). */
  badge?: string | null;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SHORTCUT_KEY = 'apex.directory.slash';

// The "/" switch, remembered on this device. A tiny external store, so the server render and
// hydration agree (on) and the stored choice applies right after, with no effect-driven setState.
let memoryPref: boolean | null = null;
const prefListeners = new Set<() => void>();
function readShortcutPref(): boolean {
  if (memoryPref !== null) return memoryPref;
  try { return window.localStorage.getItem(SHORTCUT_KEY) !== 'off'; } catch { return true; }
}
function writeShortcutPref(on: boolean) {
  memoryPref = on;
  try { window.localStorage.setItem(SHORTCUT_KEY, on ? 'on' : 'off'); } catch { /* storage blocked: the choice lasts for this visit */ }
  prefListeners.forEach((l) => l());
}
function subscribePref(l: () => void) { prefListeners.add(l); return () => { prefListeners.delete(l); }; }

/**
 * A fast, honest directory in Carbon & Light: every record the provider
 * returned, filed A to Z like a printed index. Type to filter (accents and
 * punctuation ignored, every word must match), pick a letter or a
 * nationality. The query lives in the URL (?q=, replaced in place, so a
 * cleared search stays cleared after Back) and the page works without
 * JavaScript from the server-filtered list.
 *
 * Keyboard (WCAG 2.1.4): "/" jumps back to the search field only while focus
 * is inside the directory and not in a text field, never page-wide, and the
 * shortcut has an on/off switch (remembered on this device). Escape clears.
 */
export function Directory({ items, noun, nounPlural }: { items: DirectoryItem[]; /** Kept for callers; the URL is read directly. */ initialQuery?: string; noun: string; nounPlural: string }) {
  const inputId = useId();
  const natId = useId();
  const params = useSearchParams();
  // The address bar is the source of truth once the client has it: a missing ?q= is an empty
  // query (R3-CLICK-3), never the server prop of an earlier visit replayed from the router cache.
  const [query, setQuery] = useState(() => initialDirectoryQuery(params));
  const [letter, setLetter] = useState<string | null>(() => {
    const l = params.get('letter')?.trim().toUpperCase() ?? '';
    return LETTERS.includes(l) ? l : null;
  });
  const [nationality, setNationality] = useState(() => params.get('nationality')?.trim() ?? '');
  const shortcut = useSyncExternalStore(subscribePref, readShortcutPref, () => true);
  const input = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(query);

  const keyed = useMemo(() => items.map((it) => ({ ...it, key: searchKey(`${it.name} ${it.nationality ?? ''}`) })), [items]);
  const nationalities = useMemo(() => Array.from(new Set(items.map((i) => i.nationality).filter((n): n is string => Boolean(n)))).sort(), [items]);
  const activeNationality = nationalities.includes(nationality) ? nationality : '';
  const letterCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.letter, (m.get(it.letter) ?? 0) + 1);
    return m;
  }, [items]);

  const filtered = useMemo(() => {
    const words = searchKey(deferred).split(' ').filter(Boolean);
    return keyed.filter((it) =>
      (!letter || it.letter === letter) &&
      (!activeNationality || it.nationality === activeNationality) &&
      words.every((w) => it.key.includes(w)),
    );
  }, [keyed, deferred, letter, activeNationality]);

  const groups = useMemo(() => {
    const m = new Map<string, typeof filtered>();
    for (const it of filtered) m.set(it.letter, [...(m.get(it.letter) ?? []), it]);
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Keep the search, letter and nationality in the URL without a navigation (replace, never
  // push), so a search can be shared and Back returns to exactly what was last on screen.
  useEffect(() => {
    const url = new URL(window.location.href);
    const next = directorySearch(url.searchParams, { q: deferred.trim(), letter: letter ?? '', nationality: activeNationality });
    if (next === url.search) return;
    url.search = next;
    window.history.replaceState(window.history.state, '', url);
  }, [deferred, letter, activeNationality]);

  // "/" only inside the directory, only when not typing, never with a modifier, and only when on.
  const onRegionKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // The handler sits on the directory itself, so a key press here is always inside it.
    if (!slashShortcutFocuses({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement }, { enabled: shortcut, withinDirectory: true })) return;
    e.preventDefault();
    input.current?.focus();
  };
  const toggleShortcut = () => writeShortcutPref(!shortcut);

  const clear = () => { setQuery(''); setLetter(null); setNationality(''); input.current?.focus(); };
  const filteredBy = [deferred.trim() && `“${deferred.trim()}”`, letter && `letter ${letter}`, activeNationality].filter(Boolean).join(', ');

  return (
    <div className="bc dr" style={{ background: 'transparent' }} onKeyDown={onRegionKey}>
      <form role="search" action="" method="get" onSubmit={(e) => e.preventDefault()} className="grid gap-4 md:grid-cols-[minmax(0,1fr)_17rem] md:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={inputId} className="bc-label text-[color:var(--bc-silver)]">Search {nounPlural}</label>
          <div className="relative">
            <Icon name="search" size={22} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[color:var(--bc-titanium)]" />
            <input
              ref={input}
              id={inputId}
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Name or nationality"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${inputId}-hint`}
              className="min-h-16 w-full rounded-full bg-white/[0.04] pl-14 pr-6 text-[1.15rem] text-[color:var(--bc-white)] ring-1 ring-white/45 transition-shadow duration-200 placeholder:text-[color:var(--bc-titanium)] focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-[color:var(--bc-white)]"
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor={natId} className="bc-label text-[color:var(--bc-silver)]">Nationality</label>
          <div className="relative">
            <select
              id={natId}
              value={activeNationality}
              onChange={(e) => setNationality(e.target.value)}
              className="min-h-16 w-full appearance-none rounded-full bg-white/[0.04] pl-6 pr-12 text-[1rem] text-[color:var(--bc-white)] ring-1 ring-white/45 focus:outline-none focus:ring-2 focus:ring-[color:var(--bc-white)] [&>option]:bg-[#111114]"
            >
              <option value="">All nationalities</option>
              {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <Icon name="chevron-down" size={18} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[color:var(--bc-silver)]" />
          </div>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <p id={`${inputId}-hint`} className="text-[0.875rem] text-[color:var(--bc-titanium)]">
          Accents are optional: Raikkonen finds Räikkönen.{shortcut ? ' Inside the list, press / to return to the search.' : ''}
        </p>
        <button
          type="button"
          aria-pressed={shortcut}
          onClick={toggleShortcut}
          className="inline-flex min-h-11 items-center gap-2.5 text-[0.875rem] text-[color:var(--bc-silver)] hover:text-white"
        >
          <span aria-hidden className={cn('relative inline-block h-5 w-9 rounded-full ring-1 transition-colors', shortcut ? 'bg-[color:var(--bc-white)] ring-transparent' : 'bg-transparent ring-white/30')}>
            <span className={cn('absolute top-0.5 size-4 rounded-full transition-transform duration-200 motion-reduce:transition-none', shortcut ? 'left-0.5 translate-x-4 bg-[color:var(--bc-night)]' : 'left-0.5 bg-[color:var(--bc-silver)]')} />
          </span>
          <span><kbd className="bc-mono rounded border border-white/20 px-1.5 py-0.5 text-[0.875rem]">/</kbd> shortcut {shortcut ? 'on' : 'off'}</span>
        </button>
      </div>

      <nav aria-label="Filter by letter" className="mt-8 border-y border-white/10">
        <ul className="no-scrollbar flex overflow-x-auto">
          <li>
            <button type="button" aria-pressed={letter === null} onClick={() => setLetter(null)} className={cn('relative min-h-12 min-w-12 px-3 text-[0.9rem] font-semibold transition-colors', letter === null ? 'text-[color:var(--bc-white)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-silver)] hover:text-white')}>All</button>
          </li>
          {LETTERS.map((l) => {
            const n = letterCounts.get(l) ?? 0;
            return (
              <li key={l}>
                <button
                  type="button"
                  disabled={n === 0}
                  aria-pressed={letter === l}
                  aria-label={`${l}, ${n} ${n === 1 ? noun : nounPlural}`}
                  onClick={() => setLetter(letter === l ? null : l)}
                  className={cn('bc-mono relative min-h-12 min-w-11 text-[0.92rem] transition-colors disabled:text-[color:var(--bc-graphite)]', letter === l ? 'text-[color:var(--bc-white)] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-silver)] hover:text-white')}
                >
                  {l}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <p aria-live="polite" className="bc-mono mt-6 text-[0.875rem] text-[color:var(--bc-silver)]">
        {filtered.length === items.length ? `${items.length} ${nounPlural}` : `${filtered.length} of ${items.length} ${nounPlural}${filteredBy ? `, filtered by ${filteredBy}` : ''}`}
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-4 py-14">
          <p className="bc-wide text-[1.5rem] text-[color:var(--bc-white)]">No {noun} matches {filteredBy || 'these filters'}</p>
          <p className="max-w-[56ch] text-[1rem] text-[color:var(--bc-silver)]">Try part of a name, or check the spelling without accents (Raikkonen finds Räikkönen).</p>
          <button type="button" onClick={clear} className="inline-flex min-h-11 items-center rounded-full px-5 text-[0.9rem] font-medium text-[color:var(--bc-white)] ring-1 ring-white/30 hover:ring-white/60">Clear the search</button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col">
          {groups.map(([l, rows]) => (
            <section key={l} aria-labelledby={`${inputId}-${l}`} className="grid gap-x-8 border-t border-white/10 py-7 md:grid-cols-[6.5rem_minmax(0,1fr)]">
              <h2 id={`${inputId}-${l}`} className="dr-letter text-[3.25rem] md:sticky md:top-[calc(var(--shell-h,64px)+1rem)] md:self-start md:text-[4.5rem]">{l}</h2>
              <ul className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 md:mt-0 xl:grid-cols-3">
                {rows.map((it) => (
                  <li key={it.slug} className="border-b border-white/[0.06]">
                    {/* Hundreds of rows: no viewport prefetch (each would render a driver page and spend provider budget); the page loads on tap. */}
                    <Link href={it.href} prefetch={false} className="group/row flex min-h-12 items-baseline justify-between gap-4 py-3">
                      <span className="min-w-0 break-words text-[0.98rem] font-semibold text-[color:var(--bc-white)]">
                        <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 ease-[var(--bc-ease)] group-hover/row:bg-[length:100%_2px] group-focus-visible/row:bg-[length:100%_2px]">{it.name}</span>
                        {it.badge && <span className="bc-label ml-2 whitespace-nowrap text-[0.62rem] text-[color:var(--bc-silver)]">{it.badge}</span>}
                      </span>
                      {it.nationality && <span className="shrink-0 text-[0.875rem] text-[color:var(--bc-titanium)]">{it.nationality}</span>}
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
