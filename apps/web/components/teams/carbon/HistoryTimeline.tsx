import type { CSSProperties } from 'react';
import { formatPoints } from '@/components/drivers/people';
import type { HistoryRow } from '../championship-history';

/**
 * A team's championship history as a timeline, newest first, grouped by
 * decade. Each season is one row on the spine: the year, the finishing
 * place as a gauge (longer is better, P1 fills it), points and wins in
 * timing type, and any engine-named entrant. Title seasons stand in a pool of
 * floodlight with a "Constructors' champions" plate. Seasons the team was not
 * classified are stated as gaps on the spine, never hidden.
 */
export function HistoryTimeline({ rows, titleYears, notedYears, name, color, liveSeason, lastCompleted }: {
  rows: readonly HistoryRow[];
  titleYears: ReadonlySet<number>;
  /** Seasons with a known provider error, explained in a note below the timeline (R3-DATA-4). */
  notedYears?: ReadonlySet<number>;
  name: string;
  color: string | null;
  liveSeason: number;
  lastCompleted: number;
}) {
  const sorted = rows.slice().sort((a, b) => b.year - a.year);
  const worst = Math.max(1, ...sorted.map((r) => r.position ?? 0));
  const decades = new Map<number, HistoryRow[]>();
  for (const r of sorted) {
    const d = Math.floor(r.year / 10) * 10;
    decades.set(d, [...(decades.get(d) ?? []), r]);
  }
  const accent = color ?? '#c9ccd3';
  return (
    <div className="flex flex-col">
      {Array.from(decades.entries()).map(([decade, list]) => (
        <section key={decade} aria-labelledby={`decade-${decade}`} className="grid grid-cols-1 gap-x-10 border-t border-[color:var(--bc-rule-strong)] py-8 md:grid-cols-[8rem_minmax(0,1fr)] lg:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="mb-4 md:mb-0">
            <h3 id={`decade-${decade}`} className="bc-display whitespace-nowrap text-[clamp(1.8rem,2.8vw,2.6rem)] text-white md:sticky md:top-[calc(var(--shell-h,64px)+1.5rem)]">{decade}s</h3>
            <p className="bc-label mt-2 text-[color:var(--bc-titanium)]">{list.length} {list.length === 1 ? 'season' : 'seasons'}{list.some((r) => titleYears.has(r.year)) ? ` · ${list.filter((r) => titleYears.has(r.year)).length} ${list.filter((r) => titleYears.has(r.year)).length === 1 ? 'title' : 'titles'}` : ''}</p>
          </div>
          <ol className="relative flex flex-col border-l border-[color:var(--bc-rule-strong)]">
            {list.map((r, i) => {
              const prev = list[i - 1] ?? null;
              const gapYears = prev ? prev.year - r.year - 1 : 0;
              const title = titleYears.has(r.year);
              const share = r.position !== null ? (worst - r.position + 1) / worst : 0;
              return (
                <li key={r.year} className="relative">
                  {gapYears > 0 && (
                    <p className="py-2 pl-6 text-[0.8rem] text-[color:var(--bc-titanium)]">
                      Not classified {gapYears === 1 ? r.year + 1 : `${r.year + 1}–${prev!.year - 1}`}
                    </p>
                  )}
                  <div className={`relative grid grid-cols-[4.2rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-4 pl-6 pr-3 sm:grid-cols-[4.6rem_minmax(0,1fr)_auto] ${title ? 'tc-title-pool rounded-r-lg' : ''}`}>
                    <span aria-hidden className={`absolute left-0 top-1/2 h-[2px] -translate-y-1/2 ${title ? 'w-4 bg-white' : 'w-2.5 bg-[color:var(--bc-graphite)]'}`} />
                    <span className="bc-mono flex flex-col text-[1.25rem] leading-none text-white">
                      {r.year}
                      {r.year > lastCompleted && r.year === liveSeason && r.round !== null && <span className="mt-1 text-[0.66rem] text-[color:var(--bc-titanium)]">After R{r.round}</span>}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={`bc-wide text-[1.15rem] ${title ? 'text-white' : 'text-[color:var(--bc-white)]'}`}>{r.positionText.match(/^\d+$/) ? `P${r.positionText}` : r.positionText}</span>
                        {title && <span className="bc-label rounded-full bg-white px-2.5 py-1 text-[0.62rem] text-[color:var(--bc-night)]">Constructors&apos; champions</span>}
                        {r.entrants.length > 0 && <span className="text-[0.8rem] text-[color:var(--bc-silver)]">as {r.entrants.join(', ')}</span>}
                        {notedYears?.has(r.year) && <span className="text-[0.8rem] text-[color:var(--bc-silver)]">See note below</span>}
                      </div>
                      <div aria-hidden className="relative mt-2 h-[3px] max-w-[28rem] overflow-hidden rounded-full bg-white/[0.07]">
                        <span className="tc-grow-x absolute inset-y-0 left-0 rounded-full" style={{ width: `${(share * 100).toFixed(2)}%`, backgroundColor: title ? '#f4f5f7' : `color-mix(in srgb, ${accent} 70%, #9b9ea7)` } as CSSProperties} />
                      </div>
                    </div>
                    <dl className="col-span-2 flex gap-6 sm:col-span-1 sm:justify-end">
                      <div className="flex items-baseline gap-1.5">
                        <dt className="sr-only">Points</dt>
                        <dd className="bc-mono text-[1rem] text-white">{formatPoints(r.points)}</dd>
                        <span aria-hidden className="bc-label text-[0.6rem] text-[color:var(--bc-titanium)]">pts</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="sr-only">Wins</dt>
                        <dd className="bc-mono text-[1rem] text-white">{r.wins}</dd>
                        <span aria-hidden className="bc-label text-[0.6rem] text-[color:var(--bc-titanium)]">{r.wins === 1 ? 'win' : 'wins'}</span>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      <p className="sr-only">{name}: {sorted.length} classified seasons listed above, newest first.</p>
    </div>
  );
}
