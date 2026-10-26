import { Fragment } from 'react';
import { cn } from '@apex/ui';
import Link from 'next/link';
import { Heading, Label, Media, Numeral, TeamMark, type MediaCredit } from '@/components/ds';
import '@/components/brand-c/brand-c.css';
import '../carbon/drivers.css';
import { Rise } from '@/components/drivers/motion/Rise';
import { Portrait } from '@/components/ds/Portrait';
import { initialsOf } from '@/components/ds/initials';
import { byDecade, formatPoints, yearRuns } from '../people';
import { HallFinder } from './HallFinder';

export interface HallEntry {
  year: number;
  /** Champion identity for grouping (driver id, or constructor marque). */
  key: string;
  name: string;
  href: string;
  resultsHref: string;
  team?: { name: string; color: string } | null;
  nationality?: string | null;
  points: number;
  wins: number;
  /** `yearSpecific` photos (an F1 media season portrait) show on every plaque, not once per decade. */
  picture?: { kind: 'cutout' | 'photo' | 'car' | 'logo'; src: string; credit?: MediaCredit | null; yearSpecific?: boolean } | null;
}

export interface HallLeader {
  key: string;
  name: string;
  href: string;
  years: number[];
  /** The champion standing on the plinth: today's F1 media picture, or a credited Commons portrait. */
  picture?: HallEntry['picture'];
  /** Short caption for a picture that is not from a title year ("2026 car"). */
  pictureNote?: string | null;
}

/**
 * The champions hall: the leaders as plinths whose heights are their title
 * counts (labelled with the real number), then one gallery per decade with
 * a plaque per champion year. Each decade is a night gallery room, so the hall
 * reads like turning the pages of a programme. Pictures are real (Formula 1
 * media for recent seasons, credited Wikimedia Commons portraits before);
 * a plaque without one is set in type, never padded with a placeholder.
 *
 * A Commons portrait is one photograph per person, so within a decade it is
 * shown once, on that champion's newest plaque there; their other plaques in
 * the decade are set in type with the title's number ("Title 4 of 7"), so a
 * run of titles reads as a run instead of the same photo repeated. F1 media
 * cut-outs and cars are year-specific and appear on every plaque they belong
 * to.
 */
export function ChampionsHall({ entries, leaders, kind, hallId = 'hall' }: { entries: HallEntry[]; leaders: HallLeader[]; kind: 'driver' | 'constructor'; hallId?: string }) {
  const decades = byDecade(entries);
  const maxTitles = Math.max(1, ...leaders.map((l) => l.years.length));
  const counts = new Map<string, { label: string; n: number }>();
  for (const e of entries) {
    const c = counts.get(e.key) ?? { label: e.name, n: 0 };
    c.n++;
    counts.set(e.key, c);
  }
  // Title number per year ("Title 4 of 7"), counted oldest first.
  const titleNo = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const e of entries.slice().sort((a, b) => a.year - b.year)) {
    const n = (seen.get(e.key) ?? 0) + 1;
    seen.set(e.key, n);
    titleNo.set(e.year, n);
  }
  // A Commons portrait appears once per champion per decade (newest plaque first).
  const firstInDecade = new Set<number>();
  for (const d of decades) {
    const shown = new Set<string>();
    for (const e of d.rows) if (!shown.has(e.key)) { shown.add(e.key); firstInDecade.add(e.year); }
  }
  const finderOptions = Array.from(counts.entries())
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([key, c]) => ({ key, label: `${c.label} (${c.n} ${c.n === 1 ? 'title' : 'titles'})` }));

  // Carbon & Light everywhere it is used (drivers' and constructors' halls): the night
  // gallery rooms, never a paper tone.
  return (
    <div className="bc dr" style={{ background: 'transparent' }}>
      {leaders.length > 0 && (
        <section aria-labelledby="leaders-title" className="ds-container pb-[var(--space-section)]">
          <Heading level={2} size="display-m" id="leaders-title">Most titles</Heading>
          <ol className="mt-12 grid grid-cols-2 items-end gap-x-4 gap-y-12 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-6">
            {leaders.map((l) => {
              const share = l.years.length / maxTitles;
              return (
                <li key={l.key} className="group/plinth flex min-w-0 flex-col justify-end">
                  {/* The picture sits outside the link: a Commons credit is its own link. */}
                  {l.picture && (
                    <div className="px-[6%] transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out)] group-hover/plinth:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover/plinth:translate-y-0">
                      <LeaderPicture l={l} />
                    </div>
                  )}
                  <Link prefetch={false} href={l.href} className="flex min-w-0 flex-col">
                    <span
                      className="dr-plinth flex w-full flex-col justify-between gap-4 p-4"
                      style={{ minHeight: `${(7 + share * 7).toFixed(2)}rem` }}
                    >
                      <span className="flex items-baseline gap-2">
                        <Numeral value={l.years.length} size="stat-xl" />
                        <span className="font-text text-label uppercase text-fg-3">{l.years.length === 1 ? 'title' : 'titles'}</span>
                      </span>
                      <span className="flex flex-col">
                        <span className="font-text text-heading-s font-[650] text-fg text-balance underline-offset-4 group-hover/plinth:text-accent group-hover/plinth:underline">{l.name}</span>
                        <span className="mt-1 font-text text-small text-fg-2"><YearRuns years={l.years} /></span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="ds-container pb-10">
        <div className="flex flex-wrap items-end justify-between gap-6 shadow-[inset_0_-1px_0_var(--rule)] pb-6">
          <Heading level={2} size="display-m">Every champion</Heading>
          <HallFinder hallId={hallId} options={finderOptions} label={kind === 'driver' ? 'Find a champion' : 'Find a constructor'} />
        </div>
      </div>

      <div id={hallId}>
        {decades.map((d) => (
          <section key={d.decade} aria-labelledby={`decade-${d.decade}`} className="dr-room py-[var(--space-block)]">
            <div className="ds-container ds-grid gap-y-6">
              <div className="col-span-4 md:col-span-8 lg:col-span-2">
                <h3 id={`decade-${d.decade}`} className="font-display text-display-m font-extrabold tabular-nums text-fg lg:sticky lg:top-[calc(var(--nav-offset,64px)+1.5rem)]">
                  {d.decade}s
                </h3>
                <Label className="mt-2 block">{d.rows.length} {d.rows.length === 1 ? 'title' : 'titles'}</Label>
              </div>
              <Rise as="ol" className="col-span-4 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 md:col-span-8 lg:col-span-10 lg:grid-cols-3 xl:grid-cols-4">
                {d.rows.map((e) => <Plaque key={e.year} e={e} showPhoto={firstInDecade.has(e.year)} titleNo={titleNo.get(e.year) ?? null} titles={counts.get(e.key)?.n ?? 1} plate={kind === 'driver' && d.rows.some((r) => r.picture)} />)}
              </Rise>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Plaque({ e, showPhoto, titleNo, titles, plate }: { e: HallEntry; showPhoto: boolean; titleNo: number | null; titles: number; plate: boolean }) {
  const picture = e.picture && (e.picture.kind !== 'photo' || showPhoto || e.picture.yearSpecific) ? e.picture : null;
  // In a decade wall with pictures, a plaque without one gets a title plate set in type in the
  // same frame, so the wall reads as even rows instead of holes (from 640px, where it has columns).
  const withPlate = plate && !picture && titleNo !== null;
  // On a phone the wall is one column: a portrait or cut-out sits beside the text
  // (a third of the height per plaque); from 640px the plaque stacks in its column.
  const beside = picture !== null && (picture.kind === 'photo' || picture.kind === 'cutout');
  return (
    <li data-reveal data-key={e.key} className={cn('min-w-0 pt-4 shadow-[inset_0_2px_0_var(--rule-strong)] sm:flex sm:flex-col', beside ? 'grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4' : 'flex flex-col')}>
      <div className="col-span-2 flex items-baseline justify-between gap-3">
        <Link prefetch={false} href={e.resultsHref} className="inline-flex min-h-11 items-center whitespace-nowrap font-display text-stat-l font-normal-width tabular-nums text-fg underline-offset-4 hover:text-accent hover:underline">
          <span className="sr-only">{e.year} standings: </span>
          {e.year}
        </Link>
        {e.nationality && <Label>{e.nationality}</Label>}
      </div>
      {picture && <PlaquePicture e={e} p={picture} />}
      {withPlate && <TitlePlate n={titleNo} of={titles} name={e.name} />}
      <div className="flex min-w-0 flex-col">
        <Link prefetch={false} href={e.href} className="mt-3 inline-flex min-h-11 items-center font-text text-heading-m font-bold text-fg text-balance underline-offset-4 break-words hover:text-accent hover:underline">
          {e.name}
        </Link>
        {e.team && <TeamMark color={e.team.color} name={e.team.name} className="mt-1 font-text text-small text-fg-2" />}
        <p className="mt-2 font-text text-small tabular-nums text-fg-3">
          {e.wins} {e.wins === 1 ? 'win' : 'wins'}, {formatPoints(e.points)} points
        </p>
        {titles > 1 && titleNo !== null && <p className={cn('mt-1 font-text text-label uppercase text-fg-2', withPlate && 'sm:hidden')}>Title {titleNo} of {titles}</p>}
      </div>
    </li>
  );
}

/** Year runs that break only between runs, never inside "1999–2004". */
function YearRuns({ years }: { years: number[] }) {
  const runs = yearRuns(years).split(', ');
  return (
    <>
      {runs.map((run, i) => (
        // The space between runs stays outside the no-wrap span: it is the only break point.
        <Fragment key={run}><span className="whitespace-nowrap">{run}{i < runs.length - 1 ? ',' : ''}</span>{i < runs.length - 1 ? ' ' : ''}</Fragment>
      ))}
    </>
  );
}

function LeaderPicture({ l }: { l: HallLeader }) {
  const p = l.picture!;
  if (p.kind === 'cutout' || p.kind === 'photo') {
    return <Portrait src={p.src} variant={p.kind} framing="bust" name={l.name} glare sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 16vw" className="w-full" />;
  }
  if (p.kind === 'car') {
    return (
      <span className="flex flex-col gap-1 pb-2">
        <Media src={p.src} alt={`${l.name}${l.pictureNote ? `, ${l.pictureNote}` : ''}, side view`} kind="car" ratio="1200 / 264" sizes="(max-width: 640px) 45vw, 16vw" />
        {l.pictureNote && <span className="font-text text-caption text-fg-3">{l.pictureNote}</span>}
      </span>
    );
  }
  if (p.kind === 'logo') {
    return <Media src={p.src} alt={`${l.name} logo`} kind="logo" className="mb-2 w-24" sizes="96px" />;
  }
  return null;
}

function PlaquePicture({ e, p }: { e: HallEntry; p: NonNullable<HallEntry['picture']> }) {
  if (p.kind === 'cutout' || p.kind === 'photo') {
    return <Portrait src={p.src} variant={p.kind} framing="bust" name={e.name} teamColor={e.team?.color} glare className="mt-3 min-w-0 w-full" sizes="(max-width: 640px) 136px, (max-width: 1024px) 45vw, (max-width: 1280px) 30vw, 22vw" />;
  }
  if (p.kind === 'car') {
    return <Media src={p.src} alt={`${e.name} ${e.year} car, side view`} kind="car" ratio="1200 / 264" accent={e.team?.color} className="mt-3" sizes="(max-width: 640px) 90vw, 22vw" />;
  }
  if (p.kind === 'logo') {
    return <Media src={p.src} alt={`${e.name} logo`} kind="logo" className="mt-3 w-28" sizes="112px" />;
  }
  return null;
}

/**
 * A plaque's frame when this title has no picture of its own (the champion's
 * portrait is shown once per decade, on their newest plaque there): the same
 * portrait field as the pictures beside it, the champion's initials engraved
 * in outline and the title's number set in type. Real data only.
 */
function TitlePlate({ n, of, name }: { n: number; of: number; name: string }) {
  return (
    <div className="ds-portrait mt-3 hidden aspect-[4/5] w-full sm:block" data-variant="plate">
      <span aria-hidden className="ds-portrait__monogram" data-outline>{initialsOf(name)}</span>
      <div className="relative z-[4] flex h-full flex-col justify-between p-5">
        <span className="font-text text-label uppercase" style={{ color: 'var(--portrait-ink-2)' }}>{of === 1 ? 'World title' : 'Title'}</span>
        <span className="flex flex-col gap-2">
          <span className="font-display text-[clamp(4.5rem,7vw,7rem)] font-[800] font-normal-width leading-[0.82] tabular-nums" style={{ color: 'var(--portrait-ink)' }}>{n}</span>
          <span className="font-text text-small" style={{ color: 'var(--portrait-ink-2)' }}>{of === 1 ? 'Only championship' : `of ${of} championships`}</span>
        </span>
      </div>
    </div>
  );
}
