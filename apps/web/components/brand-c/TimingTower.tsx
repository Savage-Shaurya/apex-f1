'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LayoutGroup, m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';

export interface TowerRow { slug: string; position: number; code: string; lastName: string; color: string; points: number }
type View = 'gap' | 'points' | 'race';
const CYCLE_MS = 7000;

/**
 * The timing tower (grafted from direction A, relit for Carbon & Light): the
 * real top ten, turning its own pages like the broadcast graphic: gap to the
 * leader, points, points scored at the last Grand Prix. It turns only while
 * on screen, pauses on hover or focus, and a tap on a page pins it.
 */
export function TimingTower({ rows, racePoints, lastRaceShort, round }: { rows: TowerRow[]; racePoints: Record<string, number>; lastRaceShort: string | null; round: number | null }) {
  const views: Array<{ id: View; label: string }> = [
    { id: 'gap', label: 'Gap' },
    { id: 'points', label: 'Points' },
    ...(lastRaceShort && Object.keys(racePoints).length ? [{ id: 'race' as View, label: lastRaceShort }] : []),
  ];
  const [view, setView] = useState<View>('gap');
  const [pinned, setPinned] = useState(false);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(false);
  const reduced = Boolean(useReducedMotion());
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const cycling = visible && !pinned && !held && !reduced && views.length > 1;
  useEffect(() => {
    if (!cycling) return;
    const id = window.setTimeout(() => setView((v) => views[(views.findIndex((x) => x.id === v) + 1) % views.length]!.id), CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [view, cycling, views.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const leader = rows[0];
  const caption = view === 'gap' ? 'Points behind the leader' : view === 'points' ? 'Championship points' : `Points scored at the ${lastRaceShort} Grand Prix`;
  return (
    <section
      ref={root}
      aria-labelledby="bc-tower-title"
      className="overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] ring-1 ring-[color:var(--bc-rule)]"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <header className="px-5 pb-3 pt-5">
        <h3 id="bc-tower-title" className="bc-wide text-[1.05rem]">Timing tower</h3>
        <p className="mt-1 text-[0.875rem] leading-normal text-[color:var(--bc-titanium)]">{round ? `After round ${round}` : 'Latest standings'} · {caption}</p>
      </header>
      <div role="group" aria-label="Tower page" className="grid grid-flow-col border-y border-[color:var(--bc-rule)]">
        {views.map((v) => (
          <button
            key={v.id}
            type="button"
            data-tower-tab
            aria-pressed={view === v.id}
            onClick={() => { setView(v.id); setPinned(true); }}
            className={cn('relative min-h-11 px-2 text-[0.85rem] font-medium transition-colors', view === v.id ? 'bg-white/[0.06] text-white' : 'text-[color:var(--bc-titanium)] hover:text-white')}
          >
            <span className="block leading-tight">{v.label}</span>
            {view === v.id && (
              <m.span
                layoutId={reduced ? undefined : 'bc-tower-tab'}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/20"
              >
                <span
                  key={`${v.id}-${cycling}`}
                  className="absolute inset-0 origin-left bg-[color:var(--bc-red)]"
                  style={cycling ? { animation: `bc-progress ${CYCLE_MS}ms linear both` } : undefined}
                />
              </m.span>
            )}
          </button>
        ))}
      </div>
      <LayoutGroup>
        <ol className="py-1">
          {rows
            .map((r) => ({ r, value: view === 'gap' ? (leader ? leader.points - r.points : 0) : view === 'points' ? r.points : racePoints[r.code] ?? 0 }))
            // The race page re-orders the tower by points scored that day: rows slide to their new places.
            .sort((a, b) => (view === 'race' ? b.value - a.value || a.r.position - b.r.position : a.r.position - b.r.position))
            .map(({ r, value }, i) => (
              <m.li
                key={r.slug}
                layout={reduced ? false : 'position'}
                transition={{ type: 'spring', stiffness: 260, damping: 32, mass: 0.9 }}
                className={cn('grid min-h-11 grid-cols-[2rem_3px_1fr_auto] items-center gap-x-3 px-5', i % 2 === 0 && 'bg-white/[0.025]')}
              >
                <span className="bc-wide text-right text-[0.95rem] text-[color:var(--bc-silver)]">{view === 'race' ? i + 1 : r.position}</span>
                <span aria-hidden className="h-5 w-[3px] rounded-full" style={{ background: r.color }} />
                <Link href={`/drivers/${r.slug}`} className="flex min-h-11 min-w-0 items-center gap-3 transition-colors hover:text-white">
                  <span className="bc-wide text-[1rem]">{r.code}</span>
                  <span className="min-w-0 text-[0.85rem] leading-tight text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">{r.lastName}</span>
                </Link>
                <span key={view} className="bc-mono bc-swap min-w-[6ch] text-right text-[0.95rem]">
                  {view === 'gap' && i === 0 ? <span className="text-[0.8rem] text-[color:var(--bc-silver)]">Leader</span> : view === 'points' ? value : `+${value}`}
                </span>
              </m.li>
            ))}
        </ol>
      </LayoutGroup>
      <p className="sr-only" aria-live="polite">{caption}</p>
    </section>
  );
}
