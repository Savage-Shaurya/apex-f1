import Link from 'next/link';
import { Heading, Label, Text } from '@/components/ds';
import { CutoutStage } from './CutoutStage';
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
  const shareB = total > 0 ? b / total : 0.5;
  const lead = a === b ? null : a > b ? 'a' : 'b';
  return (
    <div className="py-4 shadow-[inset_0_-1px_0_var(--rule)]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3">
        <span className={`font-display text-stat-m font-normal-width tabular-nums ${lead === 'a' ? 'text-fg' : 'text-fg-2'}`}>{aValue ?? a}</span>
        <span className="text-center font-text text-label uppercase text-fg-3">{label}</span>
        <span className={`text-right font-display text-stat-m font-normal-width tabular-nums ${lead === 'b' ? 'text-fg' : 'text-fg-2'}`}>{bValue ?? b}</span>
      </div>
      <div aria-hidden className="mt-2.5 grid grid-cols-2 gap-1">
        <span className="flex justify-end bg-tone-raised">
          <span className={`block h-1.5 ${lead === 'a' ? 'bg-fg' : 'bg-fg-3'}`} style={{ width: `${shareA * 100}%` }} />
        </span>
        <span className="flex justify-start bg-tone-raised">
          <span className={`block h-1.5 ${lead === 'b' ? 'bg-fg' : 'bg-fg-3'}`} style={{ width: `${shareB * 100}%` }} />
        </span>
      </div>
      {note && <p className="mt-1.5 text-center font-text text-caption text-fg-3">{note}</p>}
    </div>
  );
}

/**
 * Two team-mates facing each other across the season's real numbers. The
 * left driver uses FOM's right-facing pose and the right driver the
 * left-facing one (falling back to the verified pose), so they look at the
 * centre line. Bars are shares of the pair's total, labelled with the real
 * counts; the leader of each row is in full ink (never red: red is reserved).
 */
export function HeadToHead({ duel, a, b, season, team, headingId }: { duel: Duel; a: DuelPerson; b: DuelPerson; season: number; team: string; headingId: string }) {
  const summary = `${season} ${team}: ${a.firstName} ${a.lastName} ${duel.a.finishAhead}, ${b.firstName} ${b.lastName} ${duel.b.finishAhead} ahead at the finish, over ${duel.races} shared Grands Prix.`;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] md:gap-x-8 lg:gap-x-12">
      <PersonColumn p={a} side="a" />
      <div className="order-last col-span-2 min-w-0 md:order-none md:col-span-1">
        <Heading level={2} size="display-m" id={headingId} className="text-center">Team-mates</Heading>
        <Text size="small" tone="muted" className="mx-auto mt-3 max-w-[44ch] text-center">
          {season} season at {team}, {duel.races} Grands Prix both started.
        </Text>
        <p className="sr-only">{summary}</p>
        <div className="mt-6">
          <Row label="Ahead at the finish" a={duel.a.finishAhead} b={duel.b.finishAhead} note={`Both classified in ${duel.bothClassified} of ${duel.races}`} />
          <Row label="Ahead on the grid" a={duel.a.gridAhead} b={duel.b.gridAhead} note="Grand Prix starting grid, a pit-lane start counts as behind" />
          <Row label="Points" a={duel.a.points} b={duel.b.points} aValue={formatPoints(duel.a.points)} bValue={formatPoints(duel.b.points)} note="Grand Prix points, sprints not included" />
          <Row label="Wins" a={duel.a.wins} b={duel.b.wins} />
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-3 py-4">
            <span className="font-display text-stat-m font-normal-width tabular-nums text-fg">{duel.a.best !== null ? `P${duel.a.best}` : 'None'}</span>
            <span className="text-center font-text text-label uppercase text-fg-3">Best finish</span>
            <span className="text-right font-display text-stat-m font-normal-width tabular-nums text-fg">{duel.b.best !== null ? `P${duel.b.best}` : 'None'}</span>
          </div>
        </div>
      </div>
      <PersonColumn p={b} side="b" />
    </div>
  );
}

function PersonColumn({ p, side }: { p: DuelPerson; side: 'a' | 'b' }) {
  const src = side === 'b' ? (facingLeft(p.cutout) ?? p.cutout) : p.cutout;
  return (
    <div className={`flex min-w-0 flex-col ${side === 'b' ? 'items-end text-right' : ''}`}>
      <CutoutStage src={src} fallbackSrc={p.cutout} teamColor={p.color} alt={`${p.firstName} ${p.lastName}`} ratio="5 / 8" className="w-full max-w-[17rem]" sizes="(max-width: 768px) 45vw, 272px" />
      <Label className="mt-4">{p.firstName}</Label>
      <Link href={`/drivers/${p.slug}`} className="inline-flex min-h-11 items-center font-text text-heading-m font-bold uppercase tracking-[0.01em] text-fg underline-offset-4 break-words hover:text-accent hover:underline">
        {p.lastName}
      </Link>
    </div>
  );
}
