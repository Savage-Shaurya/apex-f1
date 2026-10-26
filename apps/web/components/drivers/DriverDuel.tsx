import Link from 'next/link';
import type { CSSProperties } from 'react';
import { normalizeHex } from '@/components/ds/color';
import { Kicker, LitPortrait } from './carbon/primitives';
import { facingLeft } from './f1-assets';
import { formatPoints, type Duel } from './people';

export interface DuelPerson {
  slug: string;
  firstName: string;
  lastName: string;
  cutout: string | null;
  color: string;
}

function Row({ label, a, b, aValue, bValue, note }: { label: string; a: number; b: number; aValue?: string; bValue?: string; note?: string }) {
  const total = a + b;
  const shareA = total > 0 ? a / total : 0.5;
  const lead = a === b ? null : a > b ? 'a' : 'b';
  return (
    <div className="border-b border-white/10 py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3">
        <span className={`bc-mono text-[clamp(1.4rem,2.6vw,2rem)] leading-none ${lead === 'a' ? 'text-[color:var(--bc-white)]' : 'text-[color:var(--bc-titanium)]'}`}>{aValue ?? a}</span>
        <span className="bc-label text-center text-[color:var(--bc-silver)]">{label}</span>
        <span className={`bc-mono text-right text-[clamp(1.4rem,2.6vw,2rem)] leading-none ${lead === 'b' ? 'text-[color:var(--bc-white)]' : 'text-[color:var(--bc-titanium)]'}`}>{bValue ?? b}</span>
      </div>
      {/* one bar split at the pair's share: the leader's side in white, the other in titanium */}
      <div aria-hidden className="mt-3 flex h-[5px] gap-[2px] overflow-hidden rounded-full">
        <span className={`block h-full rounded-l-full ${lead === 'a' ? 'bg-[color:var(--bc-white)]' : 'bg-white/30'}`} style={{ width: `${shareA * 100}%` }} />
        <span className={`block h-full flex-1 rounded-r-full ${lead === 'b' ? 'bg-[color:var(--bc-white)]' : 'bg-white/30'}`} />
      </div>
      {note && <p className="mt-2 text-center text-[0.875rem] text-[color:var(--bc-titanium)]">{note}</p>}
    </div>
  );
}

/**
 * Team-mates, Carbon & Light: the two drivers lit in their team light facing
 * each other across the season's real numbers (FOM's right-facing pose on the
 * left, the left-facing one on the right, falling back to the verified pose).
 * Each row is one bar split at the pair's share; the leader of a row is in
 * white (red stays reserved for live and selected).
 */
export function DriverDuel({ duel, a, b, season, team, headingId }: { duel: Duel; a: DuelPerson; b: DuelPerson; season: number; team: string; headingId: string }) {
  const summary = `${season} ${team}: ${a.firstName} ${a.lastName} ${duel.a.finishAhead}, ${b.firstName} ${b.lastName} ${duel.b.finishAhead} ahead at the finish, over ${duel.races} shared Grands Prix.`;
  return (
    <div style={{ '--team': normalizeHex(a.color) ?? '#9b9ea7' } as CSSProperties}>
      <div className="text-center">
        <Kicker className="justify-center">{season} · {team}</Kicker>
        <h2 id={headingId} className="bc-display mt-4 text-[clamp(2rem,4.4vw,3.6rem)]">Team-mates</h2>
        <p className="mx-auto mt-3 max-w-[44ch] text-[0.98rem] text-[color:var(--bc-silver)]">{duel.races} Grands Prix both started.</p>
        <p className="sr-only">{summary}</p>
      </div>
      <div className="mt-10 grid grid-cols-2 items-end gap-x-4 gap-y-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)] md:gap-x-8 lg:gap-x-12">
        <Person p={a} side="a" />
        <div data-rv className="order-last col-span-2 min-w-0 md:order-none md:col-span-1 md:self-center">
          <Row label="Ahead at the finish" a={duel.a.finishAhead} b={duel.b.finishAhead} note={`Both classified in ${duel.bothClassified} of ${duel.races}`} />
          <Row label="Ahead on the grid" a={duel.a.gridAhead} b={duel.b.gridAhead} note="A pit-lane start counts as behind" />
          <Row label="Points" a={duel.a.points} b={duel.b.points} aValue={formatPoints(duel.a.points)} bValue={formatPoints(duel.b.points)} note="Grand Prix points, sprints not included" />
          <Row label="Wins" a={duel.a.wins} b={duel.b.wins} />
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 py-4">
            <span className="bc-mono text-[clamp(1.4rem,2.6vw,2rem)] leading-none">{duel.a.best !== null ? `P${duel.a.best}` : 'None'}</span>
            <span className="bc-label text-center text-[color:var(--bc-silver)]">Best finish</span>
            <span className="bc-mono text-right text-[clamp(1.4rem,2.6vw,2rem)] leading-none">{duel.b.best !== null ? `P${duel.b.best}` : 'None'}</span>
          </div>
        </div>
        <Person p={b} side="b" />
      </div>
    </div>
  );
}

function Person({ p, side }: { p: DuelPerson; side: 'a' | 'b' }) {
  const src = side === 'b' ? (facingLeft(p.cutout) ?? p.cutout) : p.cutout;
  return (
    <div className={`flex min-w-0 flex-col ${side === 'b' ? 'items-end text-right' : ''}`}>
      <LitPortrait src={src} fallbackSrc={p.cutout} name={`${p.firstName} ${p.lastName}`} teamColor={p.color} framing="bust" ratio="4 / 5" sizes="(max-width: 768px) 45vw, 300px" className="w-full max-w-[18rem]" />
      <p className="mt-4 text-[0.88rem] text-[color:var(--bc-silver)]">{p.firstName}</p>
      <Link href={`/drivers/${p.slug}`} className="bc-wide inline-flex min-h-11 max-w-full items-center break-words text-[clamp(1.05rem,2.2vw,1.6rem)] leading-tight text-[color:var(--bc-white)] underline-offset-4 hover:underline">
        {p.lastName}
      </Link>
    </div>
  );
}
