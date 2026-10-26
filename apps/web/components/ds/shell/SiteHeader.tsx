'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { cn } from '@apex/ui';
import { useCountdown } from '../use-countdown';
import { CALENDAR_FOCUS_WINDOW_MS } from '@/lib/calendar-window';
import { preciseSessionTimestamp } from '@/lib/session-calendar';
import { Icon } from '../Icon';
import { ScrollProgress } from '../ScrollProgress';
import { Wordmark } from './Wordmark';
import { activeSection, isSearchShortcut, navSections, overlayAfterRoute, type NavSeasons, type NavSection } from './nav-config';
import { SiteMenu, type MenuLead, type MenuNextRace } from './SiteMenu';
import { SiteSearch } from './SiteSearch';

export type { MenuLead, MenuNextRace };

/** What the header knows from the shell's server reads (lib/grid, lib/season, lib/home-feed). */
export interface HeaderFacts { seasons: NavSeasons; nextRace: MenuNextRace | null; lead: MenuLead | null }

/** Before the reads land: no confirmed season, no next race, no lead (links go where an outage sends them). */
const PENDING: HeaderFacts = { seasons: { calendar: null, results: null }, nextRace: null, lead: null };

const isPromise = (f: HeaderFacts | Promise<HeaderFacts>): f is Promise<HeaderFacts> => typeof (f as Promise<HeaderFacts>).then === 'function';

function ReadFacts({ facts, children }: { facts: HeaderFacts | Promise<HeaderFacts>; children: (f: HeaderFacts) => ReactNode }) {
  return <>{children(isPromise(facts) ? use(facts) : facts)}</>;
}

/**
 * Only the parts that depend on the reads wait for them, each in its own
 * boundary. The bar itself (wordmark, Give back, Search, Menu) is in the
 * first HTML: it is never swapped in after load, so Tab order and focus are
 * stable from the first paint (gate keyboard check; Give back always shown).
 */
function WithFacts({ facts, fallback = null, children }: { facts: HeaderFacts | Promise<HeaderFacts>; fallback?: ReactNode; children: (f: HeaderFacts) => ReactNode }) {
  if (!isPromise(facts)) return <>{children(facts)}</>;
  return <Suspense fallback={fallback}><ReadFacts facts={facts}>{children}</ReadFacts></Suspense>;
}

function PrimaryNav({ sections, pathname }: { sections: NavSection[]; pathname: string }) {
  const active = activeSection(sections, pathname);
  return (
    <ul className="flex h-full items-stretch gap-1 xl:gap-2">
      {sections.filter((s) => s.primary).map((s) => (
        <li key={s.label} className="flex">
          <Link
            href={s.href}
            aria-current={active === s.label ? 'page' : undefined}
            className={cn(
              'group relative inline-flex items-center gap-2 whitespace-nowrap px-2.5 font-text text-ui font-[650] transition-colors xl:px-3',
              s.accent ? 'text-accent hover:text-fg aria-[current=page]:text-fg' : 'text-fg-2 hover:text-fg aria-[current=page]:text-fg',
            )}
          >
            {s.label}
            <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 origin-left scale-x-0 bg-brand-red transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out)] group-hover:scale-x-100 group-aria-[current=page]:scale-x-100 xl:inset-x-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The next race and its real countdown (Jolpica start time). Full at md and
 * from 1400px; "R18" + countdown at 1280-1399; hidden at 1024-1279, where
 * the primary sections need the room (the menu carries the next race there).
 */
/** Longest timer a browser honours (about 24.8 days); later hand-overs happen on the next visit. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Re-renders the shell's server data once the calendar's focus window for
 * this race has closed (lib/calendar-window: race start + 3 h), so a page
 * left open through a race weekend hands the chip on to the next round
 * instead of saying "Start time passed" forever. Also checks when the tab
 * becomes visible again (timers are throttled in background tabs).
 */
export function useCalendarHandOver(startIso: string) {
  const router = useRouter();
  useEffect(() => {
    const start = preciseSessionTimestamp(startIso);
    if (start === null) return;
    const handOverAt = start + CALENDAR_FOCUS_WINDOW_MS + 30_000;
    let done = false;
    const check = () => {
      if (done || Date.now() < handOverAt) return;
      done = true;
      router.refresh();
    };
    const wait = handOverAt - Date.now();
    const timer = wait <= MAX_TIMER_MS ? window.setTimeout(check, Math.max(0, wait)) : undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [startIso, router]);
}

function NextRaceChip({ race }: { race: MenuNextRace }) {
  const c = useCountdown(race.startIso);
  useCalendarHandOver(race.startIso);
  const p = (n: number | null) => (n === null ? '--' : String(n).padStart(2, '0'));
  const clock = c.started
    ? 'Start time passed'
    : c.valid
      ? `${c.days ? `${c.days}d ` : ''}${p(c.hours)}:${p(c.minutes)}:${p(c.seconds)}`
      : 'Time not published';
  return (
    <Link
      href={race.href}
      className="hidden min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap px-2 font-text text-small text-fg-2 transition-colors hover:bg-tone-hover hover:text-fg md:inline-flex lg:hidden xl:inline-flex xl:gap-3 xl:px-3"
    >
      {/* The accessible name is the visible text plus this prefix (label in name, WCAG 2.5.3). */}
      <span className="sr-only">Race weekend: </span>
      <span className="font-[650] text-fg xl:hidden wide:inline">{`R${race.round} ${race.name}`}</span>
      <span className="hidden font-[650] text-fg xl:inline wide:hidden">R{race.round}</span>
      {/* Width reserved for "6d 16:14:00", so the server dashes turning into digits move nothing. */}
      <span className="inline-block min-w-[11ch] text-right tabular-nums" role="timer" aria-live="off">{clock}</span>
    </Link>
  );
}

/**
 * Site header (new shell). One 64px bar at every width: wordmark, primary
 * sections from lg up, the next race with its live countdown, search and the
 * menu. The Menu button is chalk outline, not red: red is kept for live
 * state, the page's one action and Give back's owner-requested accent.
 * A thin red progress line on its lower edge fills as you read. Hides on
 * scroll down and returns on scroll up or focus; sets
 * html[data-shell-version="2"] and data-nav-hidden for sticky sub-bars.
 */
export function SiteHeader({ facts, position = 'fixed' }: { /** The shell's reads; a promise streams them in without holding back the bar. */ facts: HeaderFacts | Promise<HeaderFacts>; /** `static` renders in flow with no global side effects (design preview). */ position?: 'fixed' | 'static' }) {
  const isFixed = position === 'fixed';
  const pathname = usePathname();
  // Give back's href never depends on a season, so its current state is known before the reads land.
  const active = activeSection(navSections(PENDING.seasons), pathname);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [searchFor, setSearchFor] = useState<string | null>(null);
  // Leaving the path an overlay was opened on closes it for good (R3-CLICK-1):
  // state adjusted during render, so no frame shows a reopened overlay.
  if (overlayAfterRoute(menuFor, pathname) !== menuFor) setMenuFor(null);
  if (overlayAfterRoute(searchFor, pathname) !== searchFor) setSearchFor(null);
  const menuOpen = menuFor === pathname;
  const searchOpen = searchFor === pathname;
  const [hidden, setHidden] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const flags = useRef({ hidden: false, lastY: 0 });

  useEffect(() => {
    if (!isFixed) return;
    document.documentElement.dataset.shellVersion = '2';
    return () => { delete document.documentElement.dataset.shellVersion; };
  }, [isFixed]);

  useEffect(() => {
    if (!isFixed) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const y = window.scrollY;
      const f = flags.current;
      const focused = headerRef.current?.contains(document.activeElement);
      const next = focused ? false : y > 160 && y > f.lastY + 2 ? true : y < f.lastY - 2 || y < 160 ? false : f.hidden;
      f.lastY = y;
      if (next !== f.hidden) {
        f.hidden = next;
        setHidden(next);
        document.documentElement.dataset.navHidden = next ? 'true' : 'false';
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
  }, [isFixed]);

  useEffect(() => {
    if (!isFixed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isSearchShortcut(e)) {
        e.preventDefault();
        setSearchFor(pathname);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pathname, isFixed]);

  const reveal = () => {
    flags.current.hidden = false;
    setHidden(false);
    document.documentElement.dataset.navHidden = 'false';
  };

  return (
    <>
      <header
        ref={headerRef}
        onFocusCapture={reveal}
        data-shell="nav"
        className={cn(
          'tone-carbon inset-x-0 top-0 z-[var(--z-header)] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out)] motion-reduce:transition-none',
          isFixed ? 'fixed' : 'relative',
          hidden && !menuOpen && !searchOpen ? '-translate-y-full' : 'translate-y-0',
        )}
      >
        <div className="ds-container flex h-[var(--header-h)] items-center gap-4 lg:gap-8">
          <Link href="/" aria-label="Apex home" className="inline-flex min-h-11 shrink-0 items-center">
            <Wordmark />
          </Link>

          <nav aria-label={position === 'static' ? 'Primary (preview)' : 'Primary'} className="hidden h-full lg:block">
            <WithFacts facts={facts} fallback={<PrimaryNav sections={navSections(PENDING.seasons)} pathname={pathname} />}>
              {(f) => <PrimaryNav sections={navSections(f.seasons)} pathname={pathname} />}
            </WithFacts>
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <WithFacts facts={facts}>{(f) => f.nextRace && <NextRaceChip race={f.nextRace} />}</WithFacts>
            {/* Give back (/support) stays in the main navigation at every width (owner decision): below lg, where the section bar is hidden, it sits in the bar itself. */}
            <Link
              href="/support"
              aria-current={active === 'Give back' ? 'page' : undefined}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-2 font-text text-ui font-[650] text-accent transition-colors hover:text-fg aria-[current=page]:text-fg lg:hidden"
            >
              Give back
            </Link>
            <button
              type="button"
              onClick={() => setSearchFor(pathname)}
              aria-label="Search"
              aria-keyshortcuts="Control+K Meta+K"
              title="Search (Ctrl K)"
              className="inline-flex size-11 shrink-0 items-center justify-center text-fg-2 transition-colors hover:bg-tone-hover hover:text-fg max-[359px]:hidden"
            >
              <Icon name="search" size={20} />
            </button>
            <button
              type="button"
              onClick={() => setMenuFor(menuOpen ? null : pathname)}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2.5 px-4 font-text text-ui font-[650] text-fg max-[359px]:px-3 shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-[background-color,box-shadow] hover:bg-tone-hover hover:shadow-[inset_0_0_0_1px_var(--fg)] aria-expanded:bg-fg aria-expanded:text-tone"
            >
              <span className="max-[389px]:sr-only">Menu</span>
              <Icon name="menu" size={18} />
            </button>
          </div>
        </div>
        {/* Lower edge (5px, part of --shell-h): a hairline and the 2px red scroll-progress line. */}
        <div className="relative h-[5px]">
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rule" />
          <ScrollProgress className="absolute inset-x-0 bottom-0" />
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <WithFacts facts={facts}>
            {(f) => { const sections = navSections(f.seasons); return <SiteMenu sections={sections} active={activeSection(sections, pathname)} lead={f.lead} nextRace={f.nextRace} onClose={() => setMenuFor(null)} />; }}
          </WithFacts>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {searchOpen && <WithFacts facts={facts}>{(f) => <SiteSearch seasons={f.seasons} onClose={() => setSearchFor(null)} />}</WithFacts>}
      </AnimatePresence>
    </>
  );
}
