import { NEUTRAL_TEAM_COLOUR } from '@/lib/team-colours';
import { formatPoints } from './people';

export interface PointsBar {
  year: number;
  points: number;
  /** Team colour for the bar (data colour); neutral when unknown. */
  color?: string | null;
}

/**
 * Grand Prix points per season as columns (dataviz: one series, so no
 * legend; bars start at a zero baseline; the team of record colours the bar
 * and is written under it; the value is printed on every bar). Title seasons
 * carry the word "Title" above the bar in ink (red is reserved for live,
 * next and selected, never for a result).
 * HTML columns rather than a scaled SVG, so labels stay crisp at any width;
 * on narrow screens the chart scrolls sideways inside a focusable region.
 */
export function SeasonPointsChart({ seasons, titleYears, name, caption }: { seasons: PointsBar[]; titleYears: readonly number[]; name: string; caption?: string }) {
  const max = Math.max(1, ...seasons.map((s) => s.points));
  const titles = new Set(titleYears);
  const summary = seasons.map((s) => `${s.year} ${formatPoints(s.points)}`).join(', ');
  return (
    <figure className="min-w-0">
      <div role="region" tabIndex={0} aria-label={`${name}: Grand Prix points per season. ${summary}.`} className="min-w-0 overflow-x-auto focus-visible:outline-offset-4">
        <ol aria-hidden className="flex h-[17rem] min-w-[var(--chart-min)] items-end gap-1 border-b border-white/20 lg:min-w-0 bg-[repeating-linear-gradient(to_top,rgb(255_255_255/0.06)_0_1px,transparent_1px_25%)] md:h-[20rem]" style={{ ['--chart-min' as string]: `${seasons.length * 2.75}rem` }}>
          {seasons.map((s) => {
            const pct = (s.points / max) * 100;
            const neutral = !s.color || s.color.toUpperCase() === NEUTRAL_TEAM_COLOUR.toUpperCase();
            const colour = titles.has(s.year) ? '#f4f5f7' : neutral ? 'rgb(255 255 255 / 0.32)' : s.color!;
            return (
              <li key={s.year} title={`${s.year}: ${formatPoints(s.points)} Grand Prix points${titles.has(s.year) ? ', world champion' : ''}`} className="flex h-full min-w-[2.25rem] lg:min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                {titles.has(s.year) && <span className="bc-label text-[0.62rem] text-[color:var(--bc-white)]">Title</span>}
                <span className="bc-mono text-[0.72rem] text-[color:var(--bc-silver)]">{formatPoints(s.points)}</span>
                <span className="block w-full max-w-[3rem] rounded-t-[4px]" style={{ height: `max(2px, calc(${pct}% * 0.8))`, backgroundColor: colour }} />
              </li>
            );
          })}
        </ol>
        <ol aria-hidden className="mt-2 flex min-w-[var(--chart-min)] gap-1 lg:min-w-0" style={{ ['--chart-min' as string]: `${seasons.length * 2.75}rem` }}>
          {seasons.map((s) => (
            <li key={s.year} className="min-w-[2.25rem] lg:min-w-0 flex-1 text-center bc-mono text-[0.7rem] text-[color:var(--bc-titanium)]">
              {seasons.length > 14 ? `’${String(s.year).slice(2)}` : s.year}
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-4 max-w-[60ch] text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">
        {caption ?? 'Title seasons in white. Only the current season wears its team colour; earlier seasons are neutral. Points systems changed across eras (a win scored 8 in 1950 and 25 since 2010), so compare seasons within an era.'}
      </figcaption>
    </figure>
  );
}
