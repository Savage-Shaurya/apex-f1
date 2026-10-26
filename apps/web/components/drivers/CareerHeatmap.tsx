import type { CSSProperties } from 'react';
import Link from 'next/link';
import { finishBand, raceLabel, formatPoints, tookTheFlag, type CareerSeason, type FinishBand } from './people';

/**
 * Every Grand Prix of a career on one sheet: one row per season, one cell
 * per race. The finish is read from how full the square is (an ordinal glyph
 * set in one ink, so it holds on carbon and paper and never relies on hue):
 * solid ink for a win, solid secondary ink for a podium, half filled for a
 * points finish, an empty outline for a classified finish outside the
 * points, a dash for no classified finish. Every mark is drawn in fg or fg-3,
 * both at least 3:1 against the sheet. Red is never used: it is reserved for
 * live, next and selected.
 *
 * Each season row is one link to that season's round-by-round table on the
 * career page (keyboard, touch and screen readers get the details there, and
 * the link names the season's totals). Hovering a square shows its race in a
 * native tooltip as a pointer convenience only.
 *
 * Adapted from the idea of smoothui's contribution-graph (MIT), rewritten
 * as server markup with the DS tone tokens.
 */
const BAND: Record<FinishBand, { style: CSSProperties; label: string }> = {
  win: { style: { backgroundColor: 'var(--fg)' }, label: 'Win' },
  podium: { style: { backgroundColor: 'var(--fg-3)' }, label: 'Podium' },
  points: { style: { boxShadow: 'inset 0 0 0 1.5px var(--fg-3)', backgroundImage: 'linear-gradient(to top, var(--fg-3) 50%, transparent 50%)' }, label: 'Points finish' },
  finish: { style: { boxShadow: 'inset 0 0 0 1.5px var(--fg-3)' }, label: 'Classified, no points' },
  out: { style: { backgroundImage: 'linear-gradient(var(--fg-3), var(--fg-3))', backgroundSize: '70% 2px', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }, label: 'Not classified' },
};

function cellTitle(r: CareerSeason['races'][number]): string {
  const result = r.finish !== null ? (tookTheFlag(r.status) ? `P${r.finish}` : `P${r.finish} (classified, ${r.status.toLowerCase()})`) : r.status && r.status !== 'Finished' ? r.status : r.positionText;
  const grid = r.grid ? `, from P${r.grid}` : '';
  return `${r.season} ${raceLabel(r.raceName)}: ${result}${grid}, ${formatPoints(r.points)} pts${r.team ? `, ${r.team.name}` : ''}`;
}

export function CareerHeatmap({ seasons, name, careerHref }: { seasons: CareerSeason[]; name: string; careerHref: string }) {
  const newestFirst = seasons.slice().reverse();
  const maxRaces = Math.max(1, ...seasons.map((s) => s.races.length));
  const wins = seasons.reduce((n, s) => n + s.wins, 0);
  const podiums = seasons.reduce((n, s) => n + s.podiums, 0);
  const starts = seasons.reduce((n, s) => n + s.starts, 0);
  return (
    <figure className="min-w-0">
      <div
        role="region"
        tabIndex={0}
        aria-label={`${name}: every Grand Prix by season, ${starts} starts, ${podiums} podiums, ${wins} wins. Scrolls sideways.`}
        className="dr-heat min-w-0 overflow-x-auto py-1 focus-visible:outline-offset-[-2px]"
      >
        <ol className="flex flex-col" style={{ minWidth: `calc(5rem + ${maxRaces} * 1.1875rem)` }}>
          {newestFirst.map((s) => (
            <li key={s.year}>
              <Link
                href={`${careerHref}#season-${s.year}`}
                aria-label={`${s.year}: ${s.starts} ${s.starts === 1 ? 'start' : 'starts'}, ${s.wins} ${s.wins === 1 ? 'win' : 'wins'}, ${s.podiums} ${s.podiums === 1 ? 'podium' : 'podiums'}, ${formatPoints(s.points)} points. Open the ${s.year} rounds.`}
                className="group/row grid min-h-7 grid-cols-[5rem_minmax(0,1fr)] items-center transition-colors hover:bg-tone-hover focus-visible:outline-offset-[-2px]"
              >
                <span className="sticky left-0 z-[1] flex items-center gap-2 bg-tone pr-2 transition-colors group-hover/row:bg-tone-hover">
                  <span aria-hidden className="h-4 w-1 shrink-0" style={{ backgroundColor: s.teams[0]?.color ?? 'var(--rule-strong)' }} />
                  <span className="font-text text-small font-[650] tabular-nums text-fg underline-offset-4 group-hover/row:underline">{s.year}</span>
                </span>
                <span aria-hidden className="flex gap-[3px]">
                  {s.races.map((r) => (
                    <span key={r.round} title={cellTitle(r)} className="block size-4 shrink-0" style={BAND[finishBand(r)].style} />
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-text text-small text-fg-2">
        {(Object.keys(BAND) as FinishBand[]).map((band) => (
          <span key={band} className="inline-flex items-center gap-2">
            <span aria-hidden className="block size-4" style={BAND[band].style} />
            {BAND[band].label}
          </span>
        ))}
        <span className="text-fg-3">One square per Grand Prix, newest season on top. Choose a season to read its rounds.</span>
      </figcaption>
    </figure>
  );
}
