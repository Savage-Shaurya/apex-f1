import { cn } from '@apex/ui';
import { CircuitStreak } from '@/components/brand-c/CircuitStreak';
import type { StripRound } from './poster-grid';

type Outline = { d: string; width: number; height: number };

function Mini({ o, className }: { o: Outline; className?: string }) {
  const pad = Math.max(o.width, o.height) * 0.08;
  return (
    <svg aria-hidden viewBox={`${-pad} ${-pad} ${o.width + pad * 2} ${o.height + pad * 2}`} className={className} fill="none">
      <path d={o.d} stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The calendar hero's picture (SRL-2): the season drawn as its real circuit
 * outlines (bacinger/f1-circuits geometry), lit white once run, dim while
 * ahead, and the next race's circuit large with the comet lapping it. It
 * repeats what "Every round" lists below, so the small strip is decoration
 * for assistive tech; the large circuit carries its own label.
 */
export function SeasonStrip({ strip, focus, className }: { strip: Array<StripRound<Outline>>; focus: { label: string; name: string; outline: Outline } | null; className?: string }) {
  return (
    <div className={cn('min-w-0', className)} data-season-strip>
      {focus && (
        <figure className="relative mb-4">
          <div className="relative aspect-[16/9] overflow-hidden rounded-[18px] bg-[color:var(--bc-night)] p-[4%] ring-1 ring-[color:var(--bc-rule)] lg:aspect-[2/1]">
            <div aria-hidden className="bc-carbon absolute inset-0 opacity-60" />
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgb(225_6_0/0.16),transparent_70%)]" />
            <div className="relative h-full w-full">
              <CircuitStreak d={focus.outline.d} width={focus.outline.width} height={focus.outline.height} label={`Layout of ${focus.name}`} />
            </div>
          </div>
          <figcaption className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 text-[0.85rem] text-[color:var(--bc-silver)]">
            <span className="bc-label text-[color:var(--bc-white)]">{focus.label}</span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{focus.name}</span>
          </figcaption>
        </figure>
      )}
      <ol aria-hidden className="grid grid-cols-8 gap-1.5 sm:gap-2 lg:grid-cols-12 lg:gap-1.5">
        {strip.map((s) => (
          <li
            key={s.round}
            className={cn(
              'relative grid aspect-square place-items-center rounded-[10px] ring-1',
              s.state === 'focus' ? 'bg-[rgb(225_6_0/0.12)] text-white ring-[color:var(--bc-red)]' : s.state === 'run' ? 'bg-white/[0.035] text-white/75 ring-white/10' : 'text-white/25 ring-white/[0.06]',
            )}
          >
            {s.outline ? <Mini o={s.outline} className="h-[72%] w-[72%]" /> : <span className="bc-mono text-[0.7rem]">{s.round}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
