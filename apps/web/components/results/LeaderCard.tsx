import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Portrait } from '@/components/ds';
import type { BoardRow } from './StandingsBoard';
import { fmtPoints } from './sheet';

/**
 * The leader (or champion) lit in the studio: the driver's cut-out in a
 * team-colour light field for the live season, otherwise a typographic
 * plate (no picture is invented for past seasons). Team colour is light,
 * never a text colour.
 */
export function LeaderCard({ row, kind, decided, season, portrait }: { row: BoardRow; kind: 'drivers' | 'teams'; decided: boolean; season: number; portrait: boolean }) {
  const team = row.colour ?? '#8d8f98';
  const label = decided ? `${season} ${kind === 'drivers' ? 'World Champion' : 'Constructors’ Champion'}` : 'Championship leader';
  const showPicture = portrait && Boolean(row.headshot);
  return (
    <div className="bc-in-up group relative isolate overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] ring-1 ring-[color:var(--bc-rule)]" style={{ '--d': '200ms', '--team': team } as CSSProperties}>
      <span aria-hidden className="bc-field absolute -right-[30%] -top-[30%] h-[120%] w-[110%] rounded-full opacity-50" />
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,transparent,var(--bc-red)_30%,var(--bc-red)_70%,transparent)]" />
      <div className={showPicture ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] items-end' : ''}>
        <div className="relative min-w-0 p-5 sm:p-6">
          <p className="bc-label text-[color:var(--bc-silver)]">{label}</p>
          {/* Fitted to the column by the length of the longest word, never broken mid-word. */}
          <div className="@container mt-4">
            <p className="bc-display text-[min(2.6rem,calc(100cqi/var(--fit)))]" style={{ '--fit': (Math.max(6, ...row.last.split(/\s+/).map((w) => w.length)) * 0.86).toFixed(2) } as CSSProperties}>
              <Link href={row.href} className="inline-block min-h-11 transition-colors hover:text-white">
                {row.first && <span className="block text-[max(0.5em,0.8rem)] leading-tight text-[color:var(--bc-silver)]">{row.first}</span>}
                <span className="block">{row.last}</span>
              </Link>
            </p>
          </div>
          <p className="mt-3 flex min-w-0 items-center gap-2.5 text-[0.9rem] text-[color:var(--bc-silver)]">
            {row.colour && <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: row.colour }} />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{row.sub}</span>
          </p>
          <div className="mt-6 flex items-end gap-6 border-t border-[color:var(--bc-rule)] pt-4">
            <p><span className="bc-mono block text-[clamp(2rem,3.4vw,2.8rem)] leading-none">{fmtPoints(row.points)}</span><span className="bc-label mt-2 block text-[color:var(--bc-titanium)]">Points</span></p>
            <p><span className="bc-mono block text-[clamp(1.4rem,2.2vw,1.8rem)] leading-none">{row.wins}</span><span className="bc-label mt-2 block text-[color:var(--bc-titanium)]">{row.wins === 1 ? 'Win' : 'Wins'}</span></p>
          </div>
        </div>
        {showPicture && (
          <div className="relative min-w-0 self-end pr-2 pt-6">
            <Portrait src={row.headshot} name={`${row.first} ${row.last}`} alt="" teamColor={row.colour} framing="bust" sizes="(max-width: 640px) 45vw, 18vw" priority />
          </div>
        )}
      </div>
    </div>
  );
}
