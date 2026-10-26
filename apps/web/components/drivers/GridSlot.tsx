import Link from 'next/link';
import type { CSSProperties } from 'react';
import { normalizeHex } from '@/components/ds/color';
import { LitPortrait, TeamBar } from './carbon/primitives';
import { formatPoints } from './people';

export interface GridSlotDriver {
  slug: string;
  firstName: string;
  lastName: string;
  number: number | null;
  team: string;
  color: string;
  cutout: string | null;
  headshot: string | null;
  position: number;
  points: number;
  wins: number;
}

/**
 * One grid slot in Carbon & Light: a carbon card with the driver lit in their
 * team light (the shared Portrait, masked key and rim light, the crop fading
 * into the card floor), the race number as an outlined plane behind them,
 * the championship position, name, team and points, and a thin team-colour
 * bar for the share of the leader's points. The whole card is one link;
 * hover lifts it and lets the team light spill (transform and shadow only).
 */
export function GridSlot({ d, priority = false, gap, leaderPoints }: { d: GridSlotDriver; priority?: boolean; gap?: number | null; leaderPoints?: number | null }) {
  const team = normalizeHex(d.color) ?? '#9b9ea7';
  const share = leaderPoints && leaderPoints > 0 ? Math.max(0.02, Math.min(1, d.points / leaderPoints)) : null;
  const n = Math.max(6, d.lastName.length) * 0.94;
  return (
    <Link href={`/drivers/${d.slug}`} className="group block rounded-[20px] focus-visible:outline-offset-4" style={{ '--team': team } as CSSProperties}>
      <div className="dr-cardbox dr-card @container grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-stretch">
        {/* picture side */}
        <div className="relative z-[1] min-h-0 self-end">
          {d.number !== null && (
            <span aria-hidden className="dr-plane absolute left-2 top-[0.24em] z-0 text-[clamp(4.5rem,24cqw,8.5rem)] opacity-50">{d.number}</span>
          )}
          <LitPortrait
            src={d.cutout ?? d.headshot}
            fallbackSrc={d.cutout ? d.headshot : null}
            name={`${d.firstName} ${d.lastName}`}
            alt={`${d.firstName} ${d.lastName}`}
            teamColor={team}
            framing="bust"
            ratio="4 / 5"
            priority={priority}
            glare
            sizes="(max-width: 640px) 44vw, (max-width: 1024px) 22vw, 240px"
            className="relative z-[1]"
          />
        </div>
        {/* words side */}
        <div className="relative z-[2] flex min-w-0 flex-col justify-between gap-3 py-4 pl-1 pr-4 sm:py-5 sm:pr-5">
          <div className="flex items-start justify-between gap-2">
            <p className="leading-none">
              <span className="sr-only">Championship position </span>
              <span className="bc-display text-[clamp(1.9rem,9cqw,2.9rem)] text-[color:var(--bc-white)]">P{d.position}</span>
            </p>
            {d.number !== null && (
              <p className="bc-mono pt-1 text-[0.875rem] text-[color:var(--bc-silver)]"><span className="sr-only">Car number </span>#{d.number}</p>
            )}
          </div>
          <div className="min-w-0" style={{ containerType: 'inline-size' }}>
            <p className="text-[0.88rem] text-[color:var(--bc-silver)]">{d.firstName}</p>
            <h3 className="bc-display mt-1 whitespace-nowrap leading-[1] text-[color:var(--bc-white)]" style={{ fontSize: `min(1.9rem, calc(100cqw / ${n.toFixed(2)}))` }}>
              <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-1 transition-[background-size] duration-300 ease-[var(--bc-ease)] group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]">{d.lastName}</span>
            </h3>
            <p className="mt-2 flex items-center gap-2 text-[0.875rem] leading-snug text-[color:var(--bc-silver)]"><TeamBar color={team} className="h-3.5" />{d.team}</p>
          </div>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="flex items-baseline gap-1.5">
                <span className="bc-mono text-[1.35rem] leading-none text-[color:var(--bc-white)]">{formatPoints(d.points)}</span>
                <span className="bc-label text-[0.64rem] text-[color:var(--bc-titanium)]">pts</span>
              </p>
              <p className="bc-mono text-[0.875rem] text-[color:var(--bc-silver)]">
                {gap == null ? null : gap > 0 ? <>−{formatPoints(gap)}<span className="sr-only"> points to the leader</span></> : d.position === 1 ? 'Leader' : null}
              </p>
            </div>
            {share !== null && (
              <div className="dr-bar mt-2.5" aria-hidden><span style={{ width: `${(share * 100).toFixed(1)}%` }} /></div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
