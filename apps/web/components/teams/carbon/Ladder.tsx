import type { CSSProperties } from 'react';
import { formatPoints } from '@/components/drivers/people';

export interface LadderRow {
  slug: string;
  name: string;
  color: string;
  position: number;
  points: number;
}

/**
 * The constructors' table as one glance (dataviz: a single measure, so bars
 * on a shared zero baseline, sorted, labelled with the real number; the
 * team colour marks identity only). Each row jumps to that team's bay below.
 * The bars grow once on load (transform only); the numbers are text from
 * the first paint.
 */
export function Ladder({ rows, caption }: { rows: LadderRow[]; caption: string }) {
  const top = Math.max(1, ...rows.map((r) => r.points));
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="sr-only">{caption}</figcaption>
      <ol className="flex flex-col">
        {rows.map((r, i) => {
          const gap = i === 0 ? null : rows[0]!.points - r.points;
          return (
            <li key={r.slug} className="border-b border-[color:var(--bc-rule)] last:border-b-0">
              <a href={`#team-${r.slug}`} className="group/row grid min-h-11 grid-cols-[1.8rem_minmax(0,1fr)_3.6rem] items-center gap-x-3 py-1.5 sm:grid-cols-[1.8rem_minmax(7rem,10rem)_minmax(0,1fr)_3.6rem_3.8rem]">
                <span className="bc-mono text-[0.85rem] text-[color:var(--bc-titanium)]">{r.position}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="truncate text-[0.9rem] font-semibold text-white underline-offset-4 group-hover/row:underline">{r.name}</span>
                </span>
                <span aria-hidden className="relative hidden h-[6px] overflow-hidden rounded-full bg-white/[0.06] sm:block">
                  <span className="tc-grow-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${((r.points / top) * 100).toFixed(2)}%`, backgroundColor: r.color, '--d': `${120 + i * 45}ms` } as CSSProperties} />
                </span>
                <span className="bc-mono text-right text-[0.92rem] text-white">{formatPoints(r.points)}</span>
                <span className="bc-mono hidden text-right text-[0.8rem] text-[color:var(--bc-titanium)] sm:block">{gap === null ? 'Leader' : `−${formatPoints(gap)}`}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
