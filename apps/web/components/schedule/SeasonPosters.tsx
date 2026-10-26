'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { cn } from '@apex/ui';
import { Countdown } from '@/components/brand-c/live';
import { useWeekendNow } from '@/components/race/WeekendSchedule';

export interface PosterRound {
  round: number;
  name: string;
  place: string;
  country: string;
  href: string;
  /** Circuit-local weekend dates, already worded ("30 Oct – 1 Nov 2026"). */
  dates: string;
  sprint: boolean;
  firstIso: string;
  raceIso: string;
  outline: { d: string; width: number; height: number } | null;
  winner: { name: string; team: string; color: string | null } | null;
}

export type PosterState = 'won' | 'awaiting' | 'missing' | 'live' | 'next' | 'upcoming';

const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T12:00:00Z`) : Date.parse(iso));

/** Each round's state at `now`: won (or awaiting its result) once the race has started, live during its weekend, the first round still ahead is next. */
export function posterStates(rounds: ReadonlyArray<Pick<PosterRound, 'firstIso' | 'raceIso' | 'winner'>>, now: number, winnersUnavailable: boolean): PosterState[] {
  let nextGiven = false;
  return rounds.map((r) => {
    const race = day(r.raceIso);
    const first = day(r.firstIso);
    if (Number.isFinite(race) && race <= now) return r.winner ? 'won' : winnersUnavailable ? 'missing' : 'awaiting';
    if (nextGiven) return 'upcoming';
    nextGiven = true;
    return Number.isFinite(first) && first <= now ? 'live' : 'next';
  });
}

function Outline({ o, className }: { o: NonNullable<PosterRound['outline']>; className?: string }) {
  const pad = Math.max(o.width, o.height) * 0.06;
  return (
    <svg aria-hidden viewBox={`${-pad} ${-pad} ${o.width + pad * 2} ${o.height + pad * 2}`} className={className} fill="none">
      <path d={o.d} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The season as posters, month by month: each round turns from upcoming to
 * next (red, counting down to lights out) to live during its weekend, then
 * to its winner lit in team colour once the result is published. States are
 * worked out again from the reader's clock every 15 seconds, so the grid
 * moves on by itself; the page re-reads winners on its own.
 */
export function SeasonPosters({ months, rounds, serverNow, winnersUnavailable }: { months: Array<{ month: string; rounds: number[] }>; rounds: PosterRound[]; serverNow: number; winnersUnavailable: boolean }) {
  const now = useWeekendNow(serverNow);
  const states = posterStates(rounds, now, winnersUnavailable);
  const at = new Map(rounds.map((r, i) => [r.round, i]));
  return (
    <div className="space-y-12">
      {months.map(({ month, rounds: list }) => (
        <section key={month + list[0]} aria-label={month}>
          <h3 className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-px w-6 bg-white/30" />{month}</h3>
          <ol className="mt-4 grid grid-cols-1 gap-3 min-[30rem]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {list.map((n) => {
              const i = at.get(n)!;
              const r = rounds[i]!;
              const st = states[i]!;
              const lit = st === 'won' && r.winner?.color;
              return (
                <li key={r.round} className="min-w-0" data-current={st === 'next' || st === 'live' || undefined}>
                  <Link
                    href={r.href}
                    className={cn(
                      'group relative flex h-full min-h-[8.5rem] overflow-hidden rounded-[18px] p-4 ring-1 transition-[box-shadow,transform] duration-300 min-[30rem]:min-h-[17rem] min-[30rem]:flex-col',
                      st === 'won' || st === 'awaiting' || st === 'missing' ? 'bg-[color:var(--bc-carbon)] ring-white/10 hover:ring-white/30' : '',
                      st === 'next' || st === 'live' ? 'bg-[color:var(--bc-carbon)] ring-[color:var(--bc-red)]' : '',
                      st === 'upcoming' ? 'ring-white/[0.08] hover:ring-white/25' : '',
                    )}
                    style={lit ? ({ '--team': r.winner!.color } as CSSProperties) : undefined}
                  >
                    {lit && <span aria-hidden className="bc-field absolute -right-1/3 -top-1/3 h-3/4 w-[140%] rounded-full opacity-50" />}
                    {(st === 'next' || st === 'live') && <span aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_0%,rgb(225_6_0/0.22),transparent_70%)]" />}
                    <span aria-hidden className="bc-glare" />
                    <span className="relative flex min-w-0 flex-1 flex-col">
                      <span className="bc-label flex flex-wrap justify-between gap-x-3 text-[0.66rem] text-[color:var(--bc-silver)]">
                        <span>Round {r.round}{r.sprint ? ' · Sprint' : ''}</span>
                        <span className={st === 'next' || st === 'live' ? 'text-white' : ''}>{st === 'live' ? 'This weekend' : st === 'next' ? 'Next' : ''}</span>
                      </span>
                      {r.outline && <Outline o={r.outline} className={cn('mx-auto my-3 hidden h-24 w-[78%] min-[30rem]:block', st === 'upcoming' ? 'text-white/30' : st === 'won' || st === 'awaiting' || st === 'missing' ? 'text-white/65' : 'text-white')} />}
                      <span className="mt-2 block min-[30rem]:mt-auto">
                        <span className="bc-wide block text-[1.1rem] leading-tight text-white [overflow-wrap:anywhere]">{r.place}</span>
                        <span className="mt-1 block text-[0.82rem] text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">{r.name}</span>
                        <span className="bc-mono mt-1 block text-[0.78rem] text-[color:var(--bc-titanium)]">{r.dates}</span>
                      </span>
                      <span className="mt-3 block border-t border-white/15 pt-2.5 text-[0.84rem] leading-snug">
                        {st === 'won' && r.winner ? (
                          <span className="flex min-w-0 items-center gap-2"><span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ background: r.winner.color ?? 'rgb(255 255 255 / 0.4)' }} /><span className="text-[color:var(--bc-silver)]">Won by</span> <span className="truncate font-semibold text-white">{r.winner.name}</span></span>
                        ) : st === 'next' ? (
                          <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-[color:var(--bc-silver)]">Lights out in</span><Countdown iso={r.raceIso} size="s" rolling={false} className="text-[0.84rem]" /></span>
                        ) : st === 'live' ? (
                          <span className="text-white">Race weekend under way</span>
                        ) : st === 'awaiting' ? (
                          <span className="text-[color:var(--bc-titanium)]">Result being confirmed</span>
                        ) : st === 'missing' ? (
                          <span className="text-[color:var(--bc-titanium)]">Winner unavailable right now</span>
                        ) : (
                          <span className="text-[color:var(--bc-titanium)]">Upcoming</span>
                        )}
                      </span>
                    </span>
                    {r.outline && <Outline o={r.outline} className={cn('relative ml-3 h-20 w-20 shrink-0 self-center min-[30rem]:hidden', st === 'upcoming' ? 'text-white/30' : 'text-white/70')} />}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
