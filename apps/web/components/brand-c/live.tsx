'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@apex/ui';
import { RollingNumber } from '@/components/motion/RollingNumber';
import { relativeAge } from '@/components/news/relative-age';

/* ------------------------------------------------------------------ clock */

// One shared one-second clock for every live label on the page. Server HTML
// renders dashes (snapshot null), so a ticking value never mismatches hydration.
const listeners = new Set<() => void>();
let timer: number | null = null;
function subscribe(changed: () => void) {
  listeners.add(changed);
  if (timer === null) {
    const tick = () => { listeners.forEach((l) => l()); };
    // Align to the wall-clock second so every label flips together.
    const align = window.setTimeout(() => { tick(); timer = window.setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
    timer = align;
  }
  return () => {
    listeners.delete(changed);
    if (!listeners.size && timer !== null) { window.clearInterval(timer); window.clearTimeout(timer); timer = null; }
  };
}
const snapshot = () => Math.floor(Date.now() / 1000) * 1000;
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

const pad = (n: number) => String(n).padStart(2, '0');

/* -------------------------------------------------------------- countdown */

const CELL = 'inline-block h-[1em] w-[1ch] text-center leading-none';

/** One countdown field. Server HTML shows dashes in the same 1ch x 1em boxes as a RollingNumber digit, so the first tick moves nothing. */
function Value({ v, padTo = 2, rolling }: { v: number | null; padTo?: number; rolling: boolean }) {
  if (v === null) return <span className="inline-flex">{Array.from({ length: padTo }, (_, i) => <span key={i} className={CELL}>-</span>)}</span>;
  if (rolling) return <RollingNumber value={v} pad={padTo} />;
  return <span className="inline-flex">{String(v).padStart(padTo, '0').split('').map((c, i) => <span key={i} className={CELL}>{c}</span>)}</span>;
}

export function Countdown({ iso, className, size = 'm', rolling = true }: { iso: string; className?: string; size?: 's' | 'm' | 'l'; rolling?: boolean }) {
  const now = useNow();
  const target = Date.parse(iso);
  const valid = Number.isFinite(target);
  const delta = !valid || now === null ? null : Math.max(0, target - now);
  const parts = delta === null ? null : {
    d: Math.floor(delta / 86_400_000),
    h: Math.floor((delta % 86_400_000) / 3_600_000),
    m: Math.floor((delta % 3_600_000) / 60_000),
    s: Math.floor((delta % 60_000) / 1000),
  };
  const unit = cn('bc-label text-[color:var(--bc-silver)]', size === 'l' ? 'ml-1 mr-3 text-[0.7rem]' : 'ml-0.5 mr-2 text-[0.62rem]');
  const num = size === 'l' ? 'text-[clamp(2.4rem,5.2vw,4.6rem)]' : size === 'm' ? 'text-[1.6rem]' : 'text-[1.05rem]';
  if (!valid) return <span className={className}>Start time not published</span>;
  if (delta === 0) return <span className={cn('bc-wide', className)}>Session start reached</span>;
  return (
    <span className={cn('bc-mono inline-flex items-baseline whitespace-nowrap leading-none text-[color:var(--bc-white)]', num, className)} role="timer" aria-label={parts ? `${parts.d} days ${parts.h} hours ${parts.m} minutes ${parts.s} seconds` : 'Countdown'}>
      {(parts === null || parts.d > 0) && <><Value v={parts?.d ?? null} padTo={1} rolling={rolling} /><span className={unit}>d</span></>}
      <Value v={parts?.h ?? null} rolling={rolling} /><span className={unit}>h</span>
      <Value v={parts?.m ?? null} rolling={rolling} /><span className={unit}>m</span>
      <Value v={parts?.s ?? null} rolling={rolling} /><span className={cn(unit, 'mr-0')}>s</span>
    </span>
  );
}

/* ------------------------------------------------------------ zone clock */

export function ZoneClock({ timeZone, className }: { timeZone: string; className?: string }) {
  const now = useNow();
  let label = '--:--:--';
  if (now !== null) {
    try {
      label = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
    } catch { label = '--:--:--'; }
  }
  return <time className={cn('bc-mono tabular-nums', className)} suppressHydrationWarning>{label}</time>;
}

/** Viewer's own clock for a session start (server shows the UTC label). */
export function ViewerTime({ iso, utc, className }: { iso: string; utc: string; className?: string }) {
  const label = useSyncExternalStore(
    () => () => {},
    () => {
      const ms = Date.parse(iso);
      if (!iso.includes('T') || !Number.isFinite(ms)) return utc;
      return new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
    },
    () => utc,
  );
  return <span className={className}>{label}</span>;
}

/** "8 min ago", refreshed by the shared clock. */
export function Ago({ ms, fallback, className }: { ms: number | null; fallback?: string | null; className?: string }) {
  const now = useNow();
  if (ms === null) return fallback ? <span className={className}>{fallback}</span> : null;
  if (now === null) return <span className={className}>{fallback ?? ''}</span>;
  // The site's one relative-age format, shared with /latest and /video (R3-TIME-4).
  const text = relativeAge(ms, now);
  return <time dateTime={new Date(ms).toISOString()} className={className}>{text}</time>;
}

/* ------------------------------------------------------------ the wire */

export interface WireEntry { title: string; source: string; href: string; publishedMs: number | null; age: string | null }

/* --------------------------------------------------------- self refresh */

/**
 * Keeps the page's data current with nobody touching it: re-reads the
 * server data every `everyMs` while the tab is visible, on return to the
 * tab, and a few seconds after any watched start time passes (so a hero
 * flips from countdown to "under way" to result on its own).
 */
export function AutoRefresh({ everyMs = 120_000, watch = [] }: { everyMs?: number; watch?: string[] }) {
  const router = useRouter();
  const last = useRef(0);
  const watchKey = watch.join('|');
  useEffect(() => {
    last.current = Date.now();
    const refresh = () => { if (document.hidden) return; last.current = Date.now(); router.refresh(); };
    const id = window.setInterval(refresh, everyMs);
    const onVisible = () => { if (!document.hidden && Date.now() - last.current > everyMs / 2) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const timers = (watchKey ? watchKey.split('|') : []).map((iso) => Date.parse(iso) - Date.now() + 5000).filter((ms) => ms > 0 && ms < 2 ** 31 - 1).map((ms) => window.setTimeout(refresh, ms));
    return () => { window.clearInterval(id); timers.forEach((t) => window.clearTimeout(t)); document.removeEventListener('visibilitychange', onVisible); };
  }, [router, everyMs, watchKey]);
  return null;
}

export { pad };
