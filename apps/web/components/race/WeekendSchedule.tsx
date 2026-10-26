'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '@apex/ui';
import './race.css';
import { Countdown } from '@/components/brand-c/live';
import { ClockTime, useClockFormat } from './SessionClock';
import { rephase, sessionName, type WeekendSession } from './weekend';
import type { SessionWeather } from './data';

/** Top three of a classified session, as the timeline names them. */
export interface SessionTop { code: string | null; last: string; color: string | null }

/* A 15-second browser clock shared by every timeline on the page. */
let clock = 0;
const listeners = new Set<() => void>();
let timer: number | null = null;
function subscribe(changed: () => void) {
  listeners.add(changed);
  if (timer == null) {
    clock = Date.now();
    timer = window.setInterval(() => { clock = Date.now(); listeners.forEach((l) => l()); }, 15_000);
  }
  return () => {
    listeners.delete(changed);
    if (!listeners.size && timer != null) { window.clearInterval(timer); timer = null; }
  };
}
const read = () => clock || (clock = Date.now());

/** The browser's clock, every 15 s; the server's render moment in server HTML and during hydration. */
export function useWeekendNow(serverNow: number): number {
  return useSyncExternalStore(subscribe, read, () => serverNow);
}

function Status({ s }: { s: WeekendSession }) {
  if (s.phase === 'next') return <span className="bc-label rounded-full bg-[color:var(--bc-red)] px-2.5 py-1 text-[0.66rem] text-white">Next</span>;
  if (s.phase === 'under-way') return <span className="bc-label rounded-full px-2.5 py-1 text-[0.66rem] text-white ring-1 ring-[color:var(--bc-red)]">On track</span>;
  if (s.phase === 'finished') return <span className="bc-label text-[0.66rem] text-[color:var(--bc-silver)]">Finished</span>;
  if (s.phase === 'cancelled') return <span className="bc-label text-[0.66rem] text-[color:var(--bc-red-text)]">Cancelled</span>;
  return <span className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">Upcoming</span>;
}

function weatherLine(w: SessionWeather | undefined): string | null {
  if (!w) return null;
  const parts: string[] = [];
  if (w.airC != null) parts.push(`${Math.round(w.airC)}°C`);
  if (w.sky) parts.push(w.sky.toLowerCase());
  if (w.recorded) { if (w.rainMm != null) parts.push(w.rainMm >= 0.05 ? `${w.rainMm.toFixed(1)} mm rain` : 'no rain'); }
  else if (w.rainPct != null) parts.push(`rain ${w.rainPct}%`);
  return parts.length ? parts.join(' · ') : null;
}

const BAR: Record<WeekendSession['phase'], string> = {
  finished: 'bg-white/55',
  'under-way': 'bg-[color:var(--bc-red)]',
  next: 'bg-[color:var(--bc-red)]',
  upcoming: 'bg-white/[0.14]',
  cancelled: 'bg-white/[0.14]',
};

/**
 * The weekend as a timeline: one segment per session in time order, each
 * lit white once run, red when next or on track, dark while ahead. Times in
 * the reader's chosen clock, grouped by day in that clock. Phases are worked
 * out again from the reader's clock every 15 seconds, so a page left open
 * moves from one session to the next on its own (R3-TIME-6). The next
 * session counts down; a classified session names its top three; each one
 * carries its weather (forecast ahead, recorded after).
 */
export function WeekendSchedule({ sessions, serverNow, weather, tops }: { sessions: WeekendSession[]; serverNow: number; weather: Record<string, SessionWeather> | null; tops: Partial<Record<string, SessionTop[]>> }) {
  const now = useWeekendNow(serverNow);
  const fmt = useClockFormat();
  const list = rephase(sessions, now);
  const days = list.map((s) => fmt(s.iso, 'day'));
  const recordedAll = weather != null && Object.values(weather).every((w) => w.recorded);
  const forecastAny = weather != null && Object.values(weather).some((w) => !w.recorded);
  return (
    <div>
      <ol aria-label="Sessions" className="grid grid-cols-1 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))] lg:gap-x-3" style={{ '--n': list.length } as React.CSSProperties}>
        {list.map((s, i) => {
          const newDay = i === 0 || days[i] !== days[i - 1];
          const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s.iso);
          const w = weatherLine(weather?.[s.kind + s.iso]);
          const top = s.phase === 'finished' ? tops[s.kind] : undefined;
          const live = s.phase === 'next' || s.phase === 'under-way';
          return (
            <li key={s.kind + s.iso} className="min-w-0">
              <p className={cn('bc-label pb-3 text-[color:var(--bc-titanium)]', newDay ? (i === 0 ? 'lg:pt-0' : 'pt-7 lg:pt-0') : 'hidden lg:invisible lg:block')} aria-hidden={!newDay || undefined}>
                {days[i]}
              </p>
              <div className={cn('relative grid min-h-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 border-b border-[color:var(--bc-rule)] py-4 pl-5 lg:flex lg:flex-col lg:gap-2.5 lg:border-b-0 lg:pl-0 lg:pt-6', live && 'bg-[linear-gradient(90deg,rgb(225_6_0/0.12),transparent_70%)] lg:bg-[linear-gradient(180deg,rgb(225_6_0/0.12),transparent_80%)]')}>
                <span aria-hidden className={cn('absolute bottom-3 left-0 top-3 w-[3px] overflow-hidden rounded-full lg:bottom-auto lg:right-0 lg:top-0 lg:h-[3px] lg:w-auto', BAR[s.phase])}>
                  {s.phase === 'under-way' && <span className="rp-run absolute inset-0 bg-[linear-gradient(180deg,transparent,rgb(255_255_255/0.85),transparent)] lg:bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.85),transparent)]" />}
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className={cn('bc-wide text-[1.02rem] leading-tight', s.cancelled && 'line-through decoration-2')}>{sessionName(s.kind)}</span>
                    <Status s={s} />
                  </p>
                  <p className="bc-mono mt-1.5 text-[0.95rem] text-[color:var(--bc-white)]">
                    {dateOnly ? <span className="font-text text-[0.85rem] text-[color:var(--bc-titanium)]">Start time not recorded</span> : <ClockTime iso={s.iso} endIso={s.endIso} />}
                  </p>
                  {s.scheduledIso && <p className="mt-1 text-[0.8rem] leading-snug text-[color:var(--bc-titanium)]">Started at the time shown; scheduled for <ClockTime iso={s.scheduledIso} />.</p>}
                  {w && <p className="mt-1 text-[0.82rem] leading-snug text-[color:var(--bc-silver)]">{w}</p>}
                </div>
                <div className="text-right lg:mt-1 lg:text-left">
                  {s.phase === 'next' && !dateOnly ? (
                    <span className="flex flex-col items-end gap-1 lg:items-start">
                      <span className="bc-label text-[0.62rem] text-[color:var(--bc-titanium)]">Starts in</span>
                      <Countdown iso={s.iso} size="s" rolling={false} />
                    </span>
                  ) : s.phase === 'under-way' ? (
                    <span className="block max-w-[11rem] text-[0.8rem] leading-snug text-[color:var(--bc-titanium)]">Final timing after the flag</span>
                  ) : top && top.length ? (
                    <a href="#results" className="group inline-flex min-h-11 flex-col items-end justify-center gap-1 lg:items-start" aria-label={`${sessionName(s.kind)} top three: ${top.map((t) => t.last).join(', ')}. See the results`}>
                      {top.map((t, k) => (
                        <span key={t.last + k} className="bc-mono flex items-center gap-1.5 text-[0.8rem] leading-none text-[color:var(--bc-silver)] group-hover:text-white">
                          <span className="w-5 text-[color:var(--bc-titanium)]">P{k + 1}</span>
                          <span aria-hidden className="h-3 w-[3px] rounded-full" style={{ backgroundColor: t.color ?? 'rgb(255 255 255 / 0.3)' }} />
                          {t.code ?? t.last}
                        </span>
                      ))}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {weather && (
        <p className="mt-6 text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">
          {recordedAll ? 'Weather per session as recorded nearest the circuit.' : forecastAny && Object.values(weather).some((w) => w.recorded) ? 'Weather: recorded for sessions that have run, a forecast for the rest.' : 'Weather per session is a forecast and may change as the weekend nears.'}
        </p>
      )}
    </div>
  );
}
