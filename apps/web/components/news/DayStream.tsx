'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { dayHeading, groupByDay, plural } from './news-format';

export interface DayEntry {
  key: string;
  ms: number;
  /** Spans both columns (a spread). */
  wide: boolean;
  /** The story card, rendered on the server. */
  node: ReactNode;
}

/** The viewer's zone and a minute-floored clock; null on the server and during hydration. */
const listeners = new Set<() => void>();
let timer: number | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) timer = window.setInterval(() => listeners.forEach((l) => l()), 60_000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  };
}
let cached: { tz: string | undefined; now: number } | null = null;
function snapshot() {
  const now = Math.floor(Date.now() / 60_000) * 60_000;
  if (!cached || cached.now !== now) {
    let tz: string | undefined;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = undefined; }
    cached = { tz, now };
  }
  return cached;
}

/**
 * The day-sectioned stream of /latest, grouped by the reader's own calendar
 * (R3-TIME-3). The server renders UTC days (it cannot know the reader's
 * zone); after hydration the same cards regroup under the reader's local
 * "Today" and "Yesterday". Cards are server-rendered nodes, so only the
 * headings move, and the stream starts below the fold.
 */
export function DayStream({ entries, serverNow }: { entries: DayEntry[]; serverNow: number }) {
  const viewer = useSyncExternalStore(subscribe, snapshot, () => null);
  const tz = viewer ? viewer.tz : 'UTC';
  const now = viewer?.now ?? serverNow;
  const days = groupByDay(entries, (e) => e.ms, tz);
  return (
    <>
      {days.map((day, dayIndex) => {
        const heading = day.key === 'undated' ? { relative: null, date: 'Undated' } : dayHeading(day.key, now, tz);
        const id = `day-${day.key}`;
        return (
          <section key={day.key} aria-labelledby={id} className={dayIndex === 0 ? 'pt-[clamp(3rem,6vw,5rem)]' : 'pt-[clamp(3.5rem,7vw,6rem)]'}>
            <div className="ds-container">
              <div className="flex items-end justify-between gap-6 border-b border-white/[0.16] pb-4">
                <h2 id={id} className="min-w-0">
                  {heading.relative && (
                    <span className="bc-label mb-2 flex items-center gap-3 text-[color:var(--bc-red-text)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />{heading.relative}</span>
                  )}
                  <span className="bc-wide block text-[clamp(1.35rem,1rem+1.4vw,2.1rem)] leading-tight">{heading.date}</span>
                </h2>
                <span className="bc-mono shrink-0 pb-1 text-[0.8rem] text-[color:var(--bc-titanium)]">{plural(day.items.length, 'story', 'stories')}</span>
              </div>
              <div className="grid grid-flow-row-dense lg:grid-cols-2 lg:gap-x-12">
                {day.items.map((entry) => (
                  <div key={entry.key} className={cn('min-w-0', entry.wide && 'lg:col-span-2')}>{entry.node}</div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
