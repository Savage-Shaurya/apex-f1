import Link from 'next/link';
import { Portrait } from '@/components/ds';
import { formatPoints, type Duel } from '@/components/drivers/people';

export interface LineUpDriver {
  slug: string;
  firstName: string;
  lastName: string;
  cutout: string | null;
  headshot: string | null;
  points: number | null;
  position: number | null;
}

function DuelRow({ label, a, b, aText, bText, note }: { label: string; a: number; b: number; aText?: string; bText?: string; note?: string }) {
  const total = a + b;
  const sa = total > 0 ? a / total : 0.5;
  const lead = a === b ? null : a > b ? 'a' : 'b';
  return (
    <div className="border-b border-[color:var(--bc-rule)] py-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3">
        <span className={`bc-mono text-[1.5rem] leading-none ${lead === 'a' ? 'text-white' : 'text-[color:var(--bc-silver)]'}`}>{aText ?? a}</span>
        <span className="bc-label text-center text-[0.64rem] text-[color:var(--bc-titanium)]">{label}</span>
        <span className={`bc-mono text-right text-[1.5rem] leading-none ${lead === 'b' ? 'text-white' : 'text-[color:var(--bc-silver)]'}`}>{bText ?? b}</span>
      </div>
      <div aria-hidden className="mt-2.5 flex h-[3px] gap-1">
        <span className="flex flex-1 justify-end rounded-full bg-white/[0.06]"><span className={`block h-full rounded-full ${lead === 'a' ? 'bg-white' : 'bg-white/40'}`} style={{ width: `${sa * 100}%` }} /></span>
        <span className="flex flex-1 rounded-full bg-white/[0.06]"><span className={`block h-full rounded-full ${lead === 'b' ? 'bg-white' : 'bg-white/40'}`} style={{ width: `${(1 - sa) * 100}%` }} /></span>
      </div>
      {note && <p className="mt-1.5 text-center text-[0.75rem] text-[color:var(--bc-titanium)]">{note}</p>}
    </div>
  );
}

function Person({ d, color, align }: { d: LineUpDriver; color: string; align: 'left' | 'right' }) {
  return (
    <div className={`flex min-w-0 flex-col ${align === 'right' ? 'items-end text-right' : ''}`}>
      <Portrait src={d.cutout ?? d.headshot} fallbackSrc={d.headshot} name={`${d.firstName} ${d.lastName}`} framing="bust" teamColor={color} glare sizes="(max-width: 768px) 45vw, 300px" className="w-full max-w-[19rem]" />
      <p className="mt-4 text-[0.9rem] text-[color:var(--bc-silver)]">{d.firstName}</p>
      <Link href={`/drivers/${d.slug}`} className="bc-wide inline-flex min-h-11 max-w-full items-center break-words text-[clamp(1.1rem,2.4vw,1.6rem)] text-white underline-offset-4 hover:underline">{d.lastName}</Link>
      {(d.points !== null || d.position !== null) && (
        <p className="bc-mono text-[0.85rem] text-[color:var(--bc-titanium)]">
          {[d.position !== null ? `P${d.position}` : '', d.points !== null ? `${formatPoints(d.points)} pts` : ''].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * The line-up: both drivers as lit portraits (the design system's Portrait,
 * team light field, never a sticker) facing each other across the season's
 * real team-mate numbers. Without a duel (one race, or a driver change) the
 * portraits stand side by side.
 */
export function LineUp({ drivers, duel, color, season, team }: { drivers: [LineUpDriver, LineUpDriver] | LineUpDriver[]; duel: Duel | null; color: string; season: number; team: string }) {
  const [a, b] = drivers;
  if (!a) return null;
  if (!duel || !b) {
    return (
      <ul className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {drivers.map((d) => <li key={d.slug}><Person d={d} color={color} align="left" /></li>)}
      </ul>
    );
  }
  // Duel sides follow the duel's own order.
  const left = duel.a.slug === a.slug ? a : b;
  const right = left === a ? b : a;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)] md:gap-x-8 lg:gap-x-12">
      <Person d={left} color={color} align="left" />
      <div className="order-last col-span-2 min-w-0 md:order-none md:col-span-1 md:self-center">
        <p className="sr-only">{`${season} ${team}: ${left.firstName} ${left.lastName} ${duel.a.finishAhead}, ${right.firstName} ${right.lastName} ${duel.b.finishAhead} ahead at the finish, over ${duel.races} shared Grands Prix.`}</p>
        <p className="text-center text-[0.9rem] text-[color:var(--bc-silver)]">{duel.races} Grands Prix both started</p>
        <div className="mt-2">
          <DuelRow label="Ahead at the finish" a={duel.a.finishAhead} b={duel.b.finishAhead} note={`Both classified in ${duel.bothClassified} of ${duel.races}`} />
          <DuelRow label="Ahead on the grid" a={duel.a.gridAhead} b={duel.b.gridAhead} />
          <DuelRow label="Points" a={duel.a.points} b={duel.b.points} aText={formatPoints(duel.a.points)} bText={formatPoints(duel.b.points)} note="Grand Prix points, sprints not included" />
          <DuelRow label="Wins" a={duel.a.wins} b={duel.b.wins} />
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 py-3.5">
            <span className="bc-mono text-[1.5rem] leading-none text-white">{duel.a.best !== null ? `P${duel.a.best}` : 'None'}</span>
            <span className="bc-label text-center text-[0.64rem] text-[color:var(--bc-titanium)]">Best finish</span>
            <span className="bc-mono text-right text-[1.5rem] leading-none text-white">{duel.b.best !== null ? `P${duel.b.best}` : 'None'}</span>
          </div>
        </div>
      </div>
      <Person d={right} color={color} align="right" />
    </div>
  );
}
