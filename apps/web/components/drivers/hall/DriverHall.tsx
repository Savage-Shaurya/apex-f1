import Link from 'next/link';
import { Fragment } from 'react';
import { Media } from '@/components/ds';
import { initialsOf } from '@/components/ds/initials';
import { Count, Kicker, LitPortrait } from '../carbon/primitives';
import { byDecade, formatPoints, yearRuns } from '../people';
import { fitSize } from '../fit';
import type { HallEntry, HallLeader } from './ChampionsHall';
import { HallFinder } from './HallFinder';

/**
 * The drivers' champions hall as a museum at night. The greatest stand on
 * carbon plinths whose heights are their title counts (with the real number
 * cut into the face); then one gallery room per decade, every title an
 * exhibit: a picture lamp over a titanium frame, the photograph or cut-out
 * lit inside it, and an engraved plaque under it. Pictures are real
 * (Formula 1 media for recent seasons, Wikimedia Commons portraits before;
 * credits on /references). A Commons portrait is one photograph per person,
 * so within a room it hangs once, on that champion's newest title; their
 * other titles there are engraved plates ("Title 4 of 7"), never the same
 * photo repeated and never a placeholder.
 */
export function DriverHall({ entries, leaders, hallId = 'driver-hall' }: { entries: HallEntry[]; leaders: HallLeader[]; hallId?: string }) {
  const decades = byDecade(entries);
  const maxTitles = Math.max(1, ...leaders.map((l) => l.years.length));
  const counts = new Map<string, { label: string; n: number }>();
  for (const e of entries) {
    const c = counts.get(e.key) ?? { label: e.name, n: 0 };
    c.n++;
    counts.set(e.key, c);
  }
  const titleNo = new Map<number, number>();
  const seen = new Map<string, number>();
  for (const e of entries.slice().sort((a, b) => a.year - b.year)) {
    const n = (seen.get(e.key) ?? 0) + 1;
    seen.set(e.key, n);
    titleNo.set(e.year, n);
  }
  const firstInDecade = new Set<number>();
  for (const d of decades) {
    const shown = new Set<string>();
    for (const e of d.rows) if (!shown.has(e.key)) { shown.add(e.key); firstInDecade.add(e.year); }
  }
  const finderOptions = Array.from(counts.entries())
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([key, c]) => ({ key, label: `${c.label} (${c.n} ${c.n === 1 ? 'title' : 'titles'})` }));

  return (
    <>
      {leaders.length > 0 && (
        <section aria-labelledby="leaders-title" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div aria-hidden className="bc-flood-static absolute inset-0 -z-10 opacity-80" />
          <div className="ds-container">
            <Kicker>The greatest</Kicker>
            <h2 id="leaders-title" className="bc-display mt-4 text-[clamp(2rem,4.4vw,3.6rem)]">Most titles</h2>
            <ol className="mt-14 grid grid-cols-2 items-end gap-x-4 gap-y-14 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-5">
              {leaders.map((l) => {
                const share = l.years.length / maxTitles;
                return (
                  <li key={l.key} data-rv className="group flex min-w-0 flex-col justify-end">
                    {l.picture && (l.picture.kind === 'cutout' || l.picture.kind === 'photo') && (
                      <div className="relative z-[1] mx-auto w-[86%] transition-transform duration-500 ease-[var(--bc-ease)] group-hover:-translate-y-1 motion-reduce:transition-none">
                        {l.picture.kind === 'cutout' ? (
                          <LitPortrait src={l.picture.src} name={l.name} framing="bust" ratio="4 / 5" sizes="(max-width: 640px) 40vw, (max-width: 1024px) 28vw, 15vw" />
                        ) : (
                          <div className="dr-frame !p-[5%]">
                            <Media src={l.picture.src} alt={l.name} kind="portrait" sizes="(max-width: 640px) 40vw, (max-width: 1024px) 28vw, 15vw" />
                          </div>
                        )}
                      </div>
                    )}
                    <Link prefetch={false} href={l.href} className="mt-4 flex min-w-0 flex-col rounded-[2px]">
                      <span className="dr-plinth flex w-full flex-col justify-between gap-4 p-4" style={{ minHeight: `${(7.5 + share * 8).toFixed(2)}rem` }}>
                        <span className="flex items-baseline gap-2">
                          <Count value={l.years.length} className="text-[clamp(2.4rem,4vw,3.4rem)] leading-none text-[color:var(--bc-white)]" />
                          <span className="bc-label text-[color:var(--bc-titanium)]">{l.years.length === 1 ? 'title' : 'titles'}</span>
                        </span>
                        <span className="flex flex-col">
                          <span className="text-[1.02rem] font-semibold leading-snug text-[color:var(--bc-white)] [text-wrap:balance]">
                            <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 group-hover:bg-[length:100%_2px]">{l.name}</span>
                          </span>
                          <span className="mt-1 text-[0.875rem] text-[color:var(--bc-silver)]"><YearRuns years={l.years} /></span>
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
            {/* the floor the plinths stand on */}
            <div aria-hidden className="mt-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          </div>
        </section>
      )}

      <section aria-labelledby="every-title" className="border-t border-[color:var(--bc-rule)] pt-16 lg:pt-24">
        <div className="ds-container flex flex-wrap items-end justify-between gap-x-10 gap-y-6 pb-10">
          <div>
            <Kicker>Every title since 1950</Kicker>
            <h2 id="every-title" className="bc-display mt-4 text-[clamp(2rem,4.4vw,3.6rem)]">The galleries</h2>
          </div>
          <HallFinder hallId={hallId} options={finderOptions} label="Find a champion" />
        </div>

        <div id={hallId}>
          {decades.map((d) => (
            <section key={d.decade} aria-labelledby={`decade-${d.decade}`} className="dr-room py-14 lg:py-20">
              <div className="ds-container grid gap-x-10 gap-y-10 lg:grid-cols-12">
                <div className="lg:col-span-2">
                  <div className="lg:sticky lg:top-[calc(var(--shell-h,64px)+1.5rem)]" style={{ containerType: 'inline-size' }}>
                    <h3 id={`decade-${d.decade}`} className="dr-letter whitespace-nowrap [overflow-wrap:normal]" style={{ fontSize: fitSize(`${d.decade}S`, 'clamp(3rem, 6vw, 5rem)', { stretch: 1.3, oneLine: true }) }}>{d.decade}s</h3>
                    <p className="bc-label mt-3 text-[color:var(--bc-titanium)]">{d.rows.length} {d.rows.length === 1 ? 'title' : 'titles'}</p>
                  </div>
                </div>
                <ol className="grid grid-cols-1 gap-x-8 gap-y-16 pt-6 min-[480px]:grid-cols-2 lg:col-span-10 lg:grid-cols-3 xl:grid-cols-4">
                  {d.rows.map((e) => (
                    <Exhibit key={e.year} e={e} showPhoto={firstInDecade.has(e.year)} titleNo={titleNo.get(e.year) ?? null} titles={counts.get(e.key)?.n ?? 1} />
                  ))}
                </ol>
              </div>
            </section>
          ))}
        </div>
      </section>
    </>
  );
}

function Exhibit({ e, showPhoto, titleNo, titles }: { e: HallEntry; showPhoto: boolean; titleNo: number | null; titles: number }) {
  const picture = e.picture && (e.picture.kind !== 'photo' || showPhoto || e.picture.yearSpecific) ? e.picture : null;
  return (
    <li data-rv data-key={e.key} className="dr-exhibit min-w-0">
      <div className="dr-frame">
        {picture?.kind === 'cutout' ? (
          <LitPortrait src={picture.src} name={e.name} alt={`${e.name}, ${e.year} world champion`} framing="bust" ratio="4 / 5" sizes="(max-width: 480px) 80vw, (max-width: 1024px) 40vw, 20vw" />
        ) : picture?.kind === 'photo' ? (
          <Media src={picture.src} alt={`${e.name}`} kind="portrait" sizes="(max-width: 480px) 80vw, (max-width: 1024px) 40vw, 20vw" />
        ) : (
          <TitlePlate n={titleNo ?? 1} of={titles} name={e.name} year={e.year} />
        )}
      </div>
      <div className="dr-plaque mx-[6%] mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <Link prefetch={false} href={e.resultsHref} className="bc-mono inline-flex min-h-11 items-center text-[1.5rem] leading-none text-[color:var(--bc-white)] underline-offset-4 hover:underline">
            <span className="sr-only">{e.year} standings: </span>{e.year}
          </Link>
          {e.nationality && <span className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">{e.nationality}</span>}
        </div>
        <Link prefetch={false} href={e.href} className="mt-1 inline-flex min-h-11 max-w-full items-center break-words text-[1.08rem] font-semibold leading-snug text-[color:var(--bc-white)] underline-offset-4 hover:underline">
          {e.name}
        </Link>
        {e.team && <p className="text-[0.875rem] leading-snug text-[color:var(--bc-silver)]">{e.team.name}</p>}
        <p className="bc-mono mt-2 text-[0.875rem] text-[color:var(--bc-silver)]">{e.wins} {e.wins === 1 ? 'win' : 'wins'} · {formatPoints(e.points)} pts</p>
        {titles > 1 && titleNo !== null && <p className="bc-label mt-2 text-[0.64rem] text-[color:var(--bc-titanium)]">Title {titleNo} of {titles}</p>}
      </div>
    </li>
  );
}

/** An engraved plate inside the frame when this title has no picture of its own. */
function TitlePlate({ n, of, name, year }: { n: number; of: number; name: string; year: number }) {
  return (
    <div className="relative flex aspect-[4/5] w-full flex-col [container-type:inline-size] justify-between overflow-hidden bg-[radial-gradient(closest-side_at_50%_30%,rgb(255_244_228/0.07),transparent),#0b0b0d] p-[9%]" role="img" aria-label={`${name}, ${year}: ${of === 1 ? 'world title' : `title ${n} of ${of}`}`}>
      <span aria-hidden className="dr-letter absolute right-[8%] top-[10%] text-[clamp(2.5rem,24cqw,5rem)] opacity-40">{initialsOf(name)}</span>
      <span aria-hidden className="bc-label text-[color:var(--bc-titanium)]">{of === 1 ? 'World title' : 'Title'}</span>
      <span aria-hidden className="flex flex-col gap-2">
        <span className="bc-display text-[clamp(4rem,7vw,6.5rem)] leading-[0.82] text-[color:var(--bc-white)]">{n}</span>
        <span className="text-[0.875rem] text-[color:var(--bc-silver)]">{of === 1 ? 'Only championship' : `of ${of} championships`}</span>
      </span>
    </div>
  );
}

function YearRuns({ years }: { years: number[] }) {
  const runs = yearRuns(years).split(', ');
  return (
    <>
      {runs.map((run, i) => (
        <Fragment key={run}><span className="whitespace-nowrap">{run}{i < runs.length - 1 ? ',' : ''}</span>{i < runs.length - 1 ? ' ' : ''}</Fragment>
      ))}
    </>
  );
}
