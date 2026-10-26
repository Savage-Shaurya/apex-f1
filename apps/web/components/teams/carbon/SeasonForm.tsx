import type { CSSProperties } from 'react';
import type { RaceRows } from '@/components/drivers/people';
import { formatPoints } from '@/components/drivers/people';

export interface FormRound { round: number; race: string; points: number; best: number | null }

/** Grand Prix points and best classified finish per round for one team (both cars). */
export function seasonForm(races: readonly RaceRows[], teamSlug: string): FormRound[] {
  return races
    .map((r) => {
      const rows = r.rows.filter((x) => x.constructor?.slug === teamSlug);
      if (!rows.length) return null;
      const classified = rows.filter((x) => x.position !== null && /^\d+$/.test(x.positionText)).map((x) => x.position as number);
      return { round: r.round, race: r.raceName, points: rows.reduce((a, x) => a + x.points, 0), best: classified.length ? Math.min(...classified) : null };
    })
    .filter((x): x is FormRound => x !== null)
    .sort((a, b) => a.round - b.round);
}

/**
 * Season form (dataviz: one measure per round, columns on a zero baseline,
 * labelled; the team colour marks the team, a round with a win is full
 * strength and the rest are a lighter tint of the same light). Every value is
 * also in the visually hidden table, and each column names its round on hover.
 */
export function SeasonForm({ rounds, color, name, season }: { rounds: FormRound[]; color: string; name: string; season: number }) {
  if (!rounds.length) return null;
  const top = Math.max(1, ...rounds.map((r) => r.points));
  const total = rounds.reduce((a, r) => a + r.points, 0);
  return (
    <figure className="m-0 min-w-0">
      <div aria-hidden className="relative flex h-44 items-end gap-[3px] border-b border-[color:var(--bc-rule-strong)] md:h-56 md:gap-1.5">
        {rounds.map((r, i) => (
          <div key={r.round} title={`Round ${r.round}, ${r.race}: ${formatPoints(r.points)} pts${r.best ? `, best P${r.best}` : ''}`} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="bc-mono mb-1 hidden text-center text-[0.68rem] text-[color:var(--bc-silver)] md:block">{r.points > 0 ? formatPoints(r.points) : ''}</span>
            <span
              className="tc-grow block w-full rounded-t-[2px]"
              style={{ height: `max(2px, ${((r.points / top) * 82).toFixed(2)}%)`, backgroundColor: r.best === 1 ? color : `color-mix(in srgb, ${color} 55%, #2a2a30)`, '--i': i } as CSSProperties}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-2 flex gap-[3px] md:gap-1.5">
        {rounds.map((r) => (
          <span key={r.round} className="bc-mono min-w-0 flex-1 text-center text-[0.62rem] text-[color:var(--bc-titanium)] md:text-[0.7rem]">{r.round}</span>
        ))}
      </div>
      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[0.85rem] text-[color:var(--bc-silver)]">
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: color }} />A win that round</span>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: `color-mix(in srgb, ${color} 55%, #2a2a30)` }} />Other rounds</span>
        <span>Grand Prix points per round, both cars; sprints not included. Round numbers below.</span>
      </figcaption>
      <div className="sr-only"><table>
        <caption>{name} Grand Prix points by round, {season}: {formatPoints(total)} in total</caption>
        <thead><tr><th scope="col">Round</th><th scope="col">Grand Prix</th><th scope="col">Points</th><th scope="col">Best finish</th></tr></thead>
        <tbody>{rounds.map((r) => <tr key={r.round}><th scope="row">{r.round}</th><td>{r.race}</td><td>{formatPoints(r.points)}</td><td>{r.best ? `P${r.best}` : 'Not classified'}</td></tr>)}</tbody>
      </table></div>
    </figure>
  );
}
