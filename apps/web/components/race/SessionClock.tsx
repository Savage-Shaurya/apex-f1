'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * Session times in the reader's choice of clock: their own time zone, the
 * circuit's local time or UTC. Circuit time uses the circuit's IANA zone for
 * each session (a DST change mid-weekend moves the clock, R3-TIME-5); only
 * when no zone is known does it fall back to the fixed published offset.
 * Server HTML renders UTC so hydration never disagrees; the reader's zone
 * replaces it after mount. The choice is a per-viewer convenience kept in
 * localStorage (guarded: private windows fall back to "Your time").
 */
export type ClockMode = 'local' | 'track' | 'utc';

const KEY = 'apex:session-clock';
const listeners = new Set<() => void>();
function readMode(): ClockMode {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'track' || v === 'utc' ? v : 'local';
  } catch {
    return 'local';
  }
}
let memory: ClockMode | null = null;
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function snapshot(): ClockMode { return memory ?? readMode(); }
function setMode(mode: ClockMode) {
  memory = mode;
  try { window.localStorage.setItem(KEY, mode); } catch { /* storage blocked: keep in memory */ }
  listeners.forEach((l) => l());
}

type ClockCtx = { offsetMin: number | null; trackLabel: string | null; zone: string | null };
const Ctx = createContext<ClockCtx>({ offsetMin: null, trackLabel: null, zone: null });

export function SessionClockProvider({ offsetMin, trackLabel, zone = null, children }: { offsetMin: number | null; trackLabel: string | null; zone?: string | null; children: ReactNode }) {
  const value = useMemo(() => ({ offsetMin, trackLabel, zone }), [offsetMin, trackLabel, zone]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hydrated mode: 'utc' on the server and first paint, then the stored choice. */
function useMode(): { mode: ClockMode; hydrated: boolean } {
  const { offsetMin, zone } = useContext(Ctx);
  const stored = useSyncExternalStore(subscribe, snapshot, () => 'utc' as ClockMode);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const mode = stored === 'track' && offsetMin == null && !zone ? 'local' : stored;
  return { mode: hydrated ? mode : 'utc', hydrated };
}

function offsetName(min: number): string {
  if (min === 0) return 'UTC';
  const sign = min > 0 ? '+' : '-';
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

export function formatClock(iso: string, mode: ClockMode, offsetMin: number | null, parts: 'time' | 'day' | 'day-time' = 'time', zone: string | null = null): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Time to be confirmed';
  const byZone = mode === 'track' && zone != null;
  const shifted = mode === 'track' && !byZone && offsetMin != null ? new Date(t + offsetMin * 60_000) : new Date(t);
  const timeZone = mode === 'local' ? undefined : byZone ? zone : 'UTC';
  const opts: Intl.DateTimeFormatOptions =
    parts === 'day' ? { weekday: 'short', day: 'numeric', month: 'short', timeZone }
      : parts === 'day-time' ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }
        : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone };
  return shifted.toLocaleString('en-GB', opts);
}

/** A session time (or range) in the chosen clock, as a <time> element. */
export function ClockTime({ iso, endIso, parts = 'time', className }: { iso: string; endIso?: string | null; parts?: 'time' | 'day' | 'day-time'; className?: string }) {
  const { offsetMin, zone } = useContext(Ctx);
  const { mode } = useMode();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    // Old seasons publish a date without a start time: say so once, never invent a time.
    const day = formatClock(`${iso}T12:00:00Z`, 'utc', null, 'day');
    return <time dateTime={iso} className={className}>{parts === 'day' ? day : parts === 'time' ? 'Start time not recorded' : `${day} · start time not recorded`}</time>;
  }
  const start = formatClock(iso, mode, offsetMin, parts, zone);
  const end = endIso ? formatClock(endIso, mode, offsetMin, 'time', zone) : null;
  return (
    <time dateTime={iso} className={cn('tabular-nums', className)}>
      {start}{end ? `–${end}` : ''}
    </time>
  );
}

/** Longest label ClockName is expected to print; `reserve` sizes its box to this so hydration never reflows the page. */
export const CLOCK_NAME_SIZER = 'your time (America/Argentina/Buenos Aires)';

/** Legacy IANA ids some browsers still report (R3-TIME-8: Chrome in India says "Asia/Calcutta"). */
const LEGACY_ZONES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Europe/Kiev': 'Europe/Kyiv',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
};

/** A zone id for people: current name, spaces for underscores ("Asia/Kolkata", "America/New York"). */
export function friendlyZone(zone: string): string {
  return (LEGACY_ZONES[zone] ?? zone).replace(/_/g, ' ');
}

/** Which clock is on screen, in words for a sentence ("your time (Europe/London)", "Austin time", "UTC"). */
export function clockNameText(mode: ClockMode, offsetMin: number | null, trackLabel: string | null, localZone: string | null, trackZone: string | null = null): string {
  // With the circuit's zone the offset can change within a weekend, so no fixed UTC offset is printed.
  if (mode === 'track' && trackZone) return trackLabel ?? 'circuit time';
  if (mode === 'track' && offsetMin != null) return `${trackLabel ?? 'track time'} (${offsetName(offsetMin)})`;
  if (mode === 'local') return `your time${localZone ? ` (${friendlyZone(localZone)})` : ''}`;
  return 'UTC';
}

/**
 * The clock name in a sentence. Server HTML says "UTC" (the times it renders);
 * after mount it names the reader's zone. With `reserve`, the label sits in a
 * box sized for the longest zone name, so the swap cannot push the page down
 * (layout shift measured at 0.21 before this on /schedule).
 */
export function ClockName({ className, reserve = false }: { className?: string; reserve?: boolean }) {
  const { offsetMin, trackLabel, zone } = useContext(Ctx);
  const { mode, hydrated } = useMode();
  const local = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const text = clockNameText(mode, offsetMin, trackLabel, local, zone);
  if (!reserve) return <span className={className}>{text}</span>;
  return (
    <span className={cn('inline-grid max-w-full', className)}>
      <span className="[grid-area:1/1]">{text}</span>
      <span aria-hidden className="invisible [grid-area:1/1]">{CLOCK_NAME_SIZER}</span>
    </span>
  );
}

/** Three-way clock switch (radio group semantics with buttons). */
export function ClockToggle({ className }: { className?: string }) {
  const { offsetMin, trackLabel, zone } = useContext(Ctx);
  const { mode, hydrated } = useMode();
  const choose = useCallback((m: ClockMode) => setMode(m), []);
  const options: Array<{ id: ClockMode; label: string }> = [
    { id: 'local', label: 'Your time' },
    ...(offsetMin != null || zone ? [{ id: 'track' as const, label: trackLabel ?? 'Track time' }] : []),
    { id: 'utc', label: 'UTC' },
  ];
  return (
    <div role="group" aria-label="Show session times in" className={cn('inline-flex max-w-full flex-wrap gap-1 rounded-full p-1 ring-1 ring-white/15', className)}>
      {options.map((o) => {
        const on = hydrated && mode === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => choose(o.id)}
            disabled={!hydrated}
            className={cn(
              'min-h-11 rounded-full px-4 text-[0.88rem] font-semibold transition-colors duration-200',
              on ? 'bg-[#f4f5f7] text-[#050506]' : 'text-[#c9ccd3] hover:bg-white/[0.06] hover:text-white',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Format any instant in the page's chosen clock (UTC on the server and first paint, like ClockTime). */
export function useClockFormat(): (iso: string, parts?: 'time' | 'day' | 'day-time') => string {
  const { offsetMin, zone } = useContext(Ctx);
  const { mode } = useMode();
  return useCallback((iso: string, parts: 'time' | 'day' | 'day-time' = 'time') => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatClock(`${iso}T12:00:00Z`, 'utc', null, parts === 'time' ? 'day' : parts === 'day-time' ? 'day' : parts);
    return formatClock(iso, mode, offsetMin, parts, zone);
  }, [mode, offsetMin, zone]);
}
