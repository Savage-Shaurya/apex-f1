'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type PointerEvent } from 'react';
import { cn } from '@apex/ui';

export interface RibbonSeason {
  year: number;
  /** Rounds that season (final-standings round), null when not known. */
  rounds: number | null;
  champion: string | null;
  constructor: string | null;
  current: boolean;
}

/**
 * Every season since 1950 as one bar, its height the number of rounds, the
 * season in progress in red. Mouse: point to read a season, click to open
 * it. Touch: drag or tap along the bars to read a season, then use the
 * "Open" link under them (a tap never navigates by surprise). The bars are
 * a picture; the caption link and the season list below carry the same
 * links for keyboard and screen readers.
 */
const STEP = 'grid size-11 place-items-center rounded-full text-[color:var(--bc-white)] ring-1 ring-[color:var(--bc-rule-strong)] transition-colors hover:bg-white hover:text-[color:var(--bc-night)] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[color:var(--bc-white)]';

function Chevron({ dir }: { dir: 1 | -1 }) {
  return <svg aria-hidden viewBox="0 0 16 16" className="size-4"><path d={dir < 0 ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ArchiveTimeline({ seasons }: { seasons: RibbonSeason[] }) {
  const router = useRouter();
  const [pick, setPick] = useState<RibbonSeason | null>(null);
  const [hover, setHover] = useState<RibbonSeason | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...seasons.map((s) => s.rounds ?? 0));
  const shown = hover ?? pick ?? seasons.find((s) => s.current) ?? seasons.at(-1) ?? null;
  const at = (clientX: number) => {
    const r = strip.current?.getBoundingClientRect();
    if (!r || !seasons.length) return null;
    const i = Math.floor(((clientX - r.left) / Math.max(1, r.width)) * seasons.length);
    return seasons[Math.max(0, Math.min(seasons.length - 1, i))] ?? null;
  };
  const shownIndex = shown ? seasons.findIndex((x) => x.year === shown.year) : -1;
  const step = (dir: 1 | -1) => { const next = seasons[shownIndex + dir]; if (next) { setHover(null); setPick(next); } };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = at(e.clientX);
    if (!s) return;
    if (e.pointerType === 'mouse') setHover(s);
    else if (e.buttons) setPick(s);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = at(e.clientX);
    if (!s) return;
    if (e.pointerType === 'mouse') return;
    setPick(s);
  };
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = at(e.clientX);
    // Mouse clicks open the season; touch taps only select it (the pointerdown above).
    if (s && (e.nativeEvent as globalThis.PointerEvent).pointerType === 'mouse') router.push(`/results/${s.year}/drivers`);
  };

  return (
    <figure className="min-w-0">
      <div
        ref={strip}
        aria-hidden
        className="relative flex h-40 cursor-pointer touch-pan-y items-end gap-[2px] sm:h-52 md:gap-[3px] lg:h-60"
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      >
        {seasons.map((s) => {
          const on = shown?.year === s.year;
          return (
            <span key={s.year} className="relative flex h-full min-w-0 flex-1 items-end">
              <span
                className={cn(
                  'block w-full rounded-t-[2px] transition-[background-color,box-shadow] duration-200',
                  s.current ? 'bg-[color:var(--bc-red)]' : on ? 'bg-[color:var(--bc-white)] shadow-[0_0_18px_rgb(233_240_255/0.55)]' : 'bg-[linear-gradient(180deg,rgb(233_240_255/0.62),rgb(155_158_167/0.32))]',
                  s.rounds == null && !s.current && 'bg-none bg-transparent shadow-[inset_0_0_0_1px_var(--bc-rule-strong)]',
                )}
                style={{ height: `${Math.max(6, ((s.rounds ?? max * 0.25) / max) * 100)}%` }}
              />
            </span>
          );
        })}
      </div>
      <div aria-hidden className="bc-mono relative mt-2 h-5 text-[0.72rem] text-[color:var(--bc-titanium)]">
        {seasons.map((s, i) => (s.year % 10 === 0 ? (
          <span key={s.year} className={cn('absolute top-0 border-l border-[color:var(--bc-rule-strong)] pl-1', s.year % 20 !== 0 && i > 0 && 'max-sm:hidden')} style={{ left: `${(i / seasons.length) * 100}%` }}>{s.year}</span>
        ) : null))}
      </div>
      <figcaption className="mt-6 flex min-h-[5.5rem] flex-col gap-3 border-t border-[color:var(--bc-rule)] pt-5 sm:flex-row sm:items-center sm:justify-between">
        {shown && (
          <>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="bc-wide text-[1.9rem] leading-none text-[color:var(--bc-white)]">{shown.year}</span>
              <span className="min-w-0 text-[0.95rem] text-[color:var(--bc-white)]">{shown.champion ? <>Champion <span className="font-semibold">{shown.champion}</span></> : shown.current ? 'Season in progress' : 'Champion unavailable'}</span>
              {shown.constructor && <span className="text-[0.9rem] text-[color:var(--bc-silver)]">Constructors: {shown.constructor}</span>}
              <span className="text-[0.85rem] text-[color:var(--bc-titanium)]">{shown.rounds != null ? <><span className="bc-mono">{shown.rounds}</span> rounds</> : 'Rounds unavailable'}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            <button type="button" onClick={() => step(-1)} disabled={shownIndex <= 0} aria-label={`Show ${seasons[shownIndex - 1]?.year ?? 'the earlier'} season`} className={STEP}><Chevron dir={-1} /></button>
            <button type="button" onClick={() => step(1)} disabled={shownIndex >= seasons.length - 1} aria-label={`Show ${seasons[shownIndex + 1]?.year ?? 'the later'} season`} className={STEP}><Chevron dir={1} /></button>
            <Link href={`/results/${shown.year}/drivers`} className="inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full bg-[color:var(--bc-white)] px-5 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-colors hover:bg-[color:var(--bc-silver)]">
              Open {shown.year}
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
            </span>
          </>
        )}
      </figcaption>
      <p className="sr-only" aria-live="polite">{pick ? `${pick.year}: ${pick.champion ? `champion ${pick.champion}` : pick.current ? 'season in progress' : 'champion unavailable'}${pick.rounds != null ? `, ${pick.rounds} rounds` : ''}.` : ''}</p>
      <p className="mt-3 text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">Bar height is the number of rounds in the season; the season in progress is red. <span className="pointer-coarse:hidden">Point to a bar to read it, click to open.</span><span className="hidden pointer-coarse:inline">Drag along the bars, or use the arrows, to read a season.</span></p>
    </figure>
  );
}
