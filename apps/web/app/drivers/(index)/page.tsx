import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { getConstructorStandings, getConstructorStandingsSeason, getStandingsSeason, type GridDriver } from '@/lib/grid';
import { getPeopleGrid } from '@/components/drivers/data/people-data';
import { GridSlot } from '@/components/drivers/GridSlot';
import { ArchiveSearch } from '@/components/drivers/ArchiveSearch';
import { formatPoints } from '@/components/drivers/people';
import { withSocial } from '@/lib/page-metadata';
import { CarbonPage, DisplayTitle, Kicker, LitPortrait, TeamBar } from '@/components/drivers/carbon/primitives';
import { PressLink } from '@/components/brand-c/Press';
import { normalizeHex } from '@/components/ds/color';

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const [table, grid] = await Promise.all([getStandingsSeason(), getPeopleGrid()]);
  const leader = grid[0];
  const season = table.season;
  return withSocial({
    title: season ? `${season} Formula 1 drivers` : 'Formula 1 drivers',
    description: season && leader
      ? `All ${grid.length} drivers of the ${season} Formula 1 grid in championship order${table.round ? ` after round ${table.round}` : ''}, led by ${leader.firstName} ${leader.lastName} on ${formatPoints(leader.points)} points.`
      : 'The current Formula 1 driver grid in championship order.',
    alternates: { canonical: '/drivers' },
  });
}

type View = 'order' | 'team';

interface TeamGroup {
  slug: string;
  name: string;
  color: string;
  position: number | null;
  points: number | null;
  drivers: GridDriver[];
}

/** The front row of the championship, lit: the leader forward, P2 a step back and dimmer. */
function FrontRow({ leader, second }: { leader: GridDriver; second: GridDriver | undefined }) {
  return (
    <div className="relative mx-auto aspect-[10/9] w-full max-w-[38rem]" role="group" aria-label={`Front row: ${leader.firstName} ${leader.lastName}${second ? ` and ${second.firstName} ${second.lastName}` : ''}`}>
      {/* the horizon the drivers stand behind, and the pool of light on it */}
      <div aria-hidden className="absolute inset-x-[-10%] bottom-[6%] h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      <div aria-hidden className="absolute bottom-[6%] left-1/2 h-[30%] w-[80%] -translate-x-1/2 bg-[radial-gradient(ellipse_50%_70%_at_50%_100%,rgb(233_240_255/0.16),transparent_72%)]" />
      {second && (
        <div data-depth="1" className="absolute bottom-[6%] right-0 w-[52%] opacity-75">
          <LitPortrait src={second.cutout ?? second.headshot} fallbackSrc={second.headshot} name={`${second.firstName} ${second.lastName}`} teamColor={second.color} framing="bust" ratio="4 / 5" sizes="(max-width: 1024px) 45vw, 300px" />
          <p className="bc-label absolute bottom-3 right-3 text-[color:var(--bc-silver)]">P2</p>
        </div>
      )}
      <div data-depth="0.4" className="absolute bottom-[6%] left-0 z-[2] w-[64%]">
        {leader.number !== null && (
          <span aria-hidden className="dr-plane absolute -left-2 -top-4 z-0 text-[clamp(6rem,16vw,12rem)] opacity-50" style={{ '--team': normalizeHex(leader.color) ?? '#9b9ea7' } as CSSProperties}>{leader.number}</span>
        )}
        <LitPortrait src={leader.cutout ?? leader.headshot} fallbackSrc={leader.headshot} name={`${leader.firstName} ${leader.lastName}`} teamColor={leader.color} framing="bust" ratio="4 / 5" priority sizes="(max-width: 1024px) 60vw, 380px" className="relative z-[1]" />
        <p className="bc-label absolute bottom-3 left-3 z-[5] text-[color:var(--bc-white)]">P1 · Championship leader</p>
      </div>
    </div>
  );
}

export default async function DriversIndexPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view: rawView } = await searchParams;
  const view: View = rawView === 'team' ? 'team' : 'order';
  const [grid, table, constructors, constructorTable] = await Promise.all([getPeopleGrid(), getStandingsSeason(), getConstructorStandings(), getConstructorStandingsSeason()]);
  const season = table.season;
  const leader = grid[0];
  const second = grid[1];
  const teamRow = new Map((constructorTable.season === season ? constructors : []).map((c) => [c.constructor.slug, c]));

  const groups = new Map<string, TeamGroup>();
  for (const d of grid) {
    const g = groups.get(d.teamSlug) ?? { slug: d.teamSlug, name: d.team, color: d.color, position: teamRow.get(d.teamSlug)?.position ?? null, points: teamRow.get(d.teamSlug)?.points ?? null, drivers: [] };
    g.drivers.push(d);
    groups.set(d.teamSlug, g);
  }
  const teams = Array.from(groups.values()).sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || (a.drivers[0]?.position ?? 99) - (b.drivers[0]?.position ?? 99));

  const title = season ? `The ${season} grid` : 'The grid';
  const standingLine = season
    ? table.previousSeasonFinal
      ? `Final ${season} standings: the new season has not run a classified round yet.`
      : table.round
        ? `Championship order after round ${table.round} of ${season}.`
        : `Championship order for ${season}.`
    : null;
  const kicker = season ? (table.round && !table.previousSeasonFinal ? `Drivers · ${season} · after round ${table.round}` : `Drivers · ${season}`) : 'Drivers';
  const gapTop = leader && second ? leader.points - second.points : null;

  return (
    <CarbonPage>
      {/* ------------------------------------------------------------ hero */}
      <section aria-labelledby="grid-title" className="relative isolate overflow-hidden border-b border-[color:var(--bc-rule)]">
        <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0" />
        <div aria-hidden className="bc-haze pointer-events-none absolute inset-[-10%] bg-[radial-gradient(ellipse_40%_30%_at_70%_40%,rgb(233_240_255/0.05),transparent_70%)]" />
        <div className="ds-container relative grid items-end gap-x-10 gap-y-8 pb-0 pt-10 md:pt-14 lg:grid-cols-12 lg:pt-16">
          <div className="pb-2 lg:col-span-6 lg:pb-16">
            <Kicker className="bc-in-up">{kicker}</Kicker>
            <DisplayTitle id="grid-title" text={title} className="mt-5" />
            <p className="bc-in-up mt-5 max-w-[46ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]" style={{ '--d': '240ms' } as CSSProperties}>
              {grid.length
                ? `${grid.length} drivers, ${teams.length} teams. ${standingLine ?? ''}`
                : table.state === 'unavailable'
                  ? 'The grid can\'t be shown right now. Please check back in a few minutes.'
                  : 'No driver standings have been published for the current season yet.'}
            </p>
            {leader && second && gapTop !== null && !table.previousSeasonFinal && (
              <p className="bc-in-up mt-4 max-w-[46ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)]" style={{ '--d': '320ms' } as CSSProperties}>
                {leader.firstName} <span className="text-[color:var(--bc-white)]">{leader.lastName}</span> leads {second.lastName} by <span className="bc-mono text-[color:var(--bc-white)]">{formatPoints(gapTop)} pts</span>.
              </p>
            )}
            <div className="bc-in-up mt-7 flex flex-wrap gap-3" style={{ '--d': '400ms' } as CSSProperties}>
              <PressLink href="/drivers/all" variant="solid">Every driver since 1950 <span aria-hidden>→</span></PressLink>
              <PressLink href="/drivers/champions" variant="ghost">World champions</PressLink>
            </div>
          </div>
          {leader && (
            <div className="bc-in-strike lg:col-span-6" style={{ '--d': '200ms' } as CSSProperties}>
              <FrontRow leader={leader} second={second} />
            </div>
          )}
        </div>
        {leader && (
          <div className="relative border-t border-white/10 bg-[#070709]/90">
            <dl className="ds-container grid grid-cols-2 gap-x-6 sm:grid-cols-4">
              <Fact label="Leader" value={leader.lastName} note={leader.team} color={leader.color} />
              <Fact label="Points" value={formatPoints(leader.points)} mono note={`${leader.wins} ${leader.wins === 1 ? 'win' : 'wins'}`} />
              {second && gapTop !== null && <Fact label="Gap to P2" value={formatPoints(gapTop)} mono note={second.lastName} />}
              {table.round !== null && !table.previousSeasonFinal && <Fact label="Rounds run" value={String(table.round)} mono note={season ? String(season) : undefined} />}
            </dl>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ grid */}
      {grid.length === 0 ? (
        <section className="ds-container py-20">
          <h2 className="bc-wide text-[1.4rem]">Driver standings unavailable</h2>
          <p className="mt-3 max-w-[56ch] text-[color:var(--bc-silver)]">
            {table.state === 'unavailable'
              ? 'The standings can\'t be shown right now. They return here on their own. Every driver since 1950 is still a search away.'
              : 'The season has no classified round yet, so there is no championship order to show.'}
          </p>
          <div className="mt-6"><PressLink href="/drivers/all" variant="solid">Search every driver since 1950</PressLink></div>
        </section>
      ) : (
        <section aria-labelledby="grid-list-title" className="relative py-16 lg:py-24">
          <div className="ds-container">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Kicker>{view === 'order' ? 'Starting order' : 'Team by team'}</Kicker>
                <h2 id="grid-list-title" className="bc-display mt-4 text-[clamp(1.9rem,4vw,3.2rem)]">{view === 'order' ? 'Championship order' : 'By team'}</h2>
              </div>
              <nav aria-label="Grid view" className="dr-seg">
                <Link href="/drivers" aria-current={view === 'order' ? 'page' : undefined} scroll={false}>Championship order</Link>
                <Link href="/drivers?view=team" aria-current={view === 'team' ? 'page' : undefined} scroll={false}>By team</Link>
              </nav>
            </div>

            {view === 'order' ? (
              // One list in championship order (reading, Tab and screen-reader order P1, P2, P3...).
              // From 768 it lays out as the two-wide starting grid: even positions sit in the right
              // column, half a slot back, by a transform only, so the DOM order never changes.
              <ol className="mt-10 grid grid-cols-1 gap-x-6 gap-y-5 md:mt-14 md:grid-cols-2 md:gap-y-8 md:pb-40 lg:gap-x-12">
                {grid.map((d, i) => (
                  <li key={d.slug} className="min-w-0 md:even:translate-y-[calc(50%+1rem)]">
                    {/* the reveal runs on the inner box: GSAP owns transform there, the stagger offset stays on the li */}
                    <div data-rv><GridSlot d={d} priority={i < 2} gap={leader ? leader.points - d.points : null} leaderPoints={leader?.points ?? null} /></div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-10 flex flex-col gap-14 md:mt-14 md:gap-20">
                {teams.map((t) => (
                  <section key={t.slug} aria-labelledby={`team-${t.slug}`} className="min-w-0">
                    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-white/10 pb-4">
                      <div className="min-w-0">
                        <p className="bc-label text-[color:var(--bc-titanium)]">{t.position ? `Constructors P${t.position}` : 'Constructors'}{t.points !== null ? ` · ${formatPoints(t.points)} pts` : ''}</p>
                        <h3 id={`team-${t.slug}`} className="bc-wide mt-2 flex items-center gap-3 text-[clamp(1.25rem,2.4vw,1.75rem)]">
                          <TeamBar color={t.color} className="h-6 w-1" />
                          <Link href={`/teams/${t.slug}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{t.name}</Link>
                        </h3>
                      </div>
                      <Link href={`/teams/${t.slug}`} className="inline-flex min-h-11 items-center gap-2 text-[0.9rem] font-medium text-[color:var(--bc-silver)] hover:text-white">Team profile <span aria-hidden>→</span></Link>
                    </header>
                    <ul className="grid gap-5 md:grid-cols-2 md:gap-x-6 lg:gap-x-12">
                      {t.drivers.map((d) => (
                        <li key={d.slug} data-rv className="min-w-0"><GridSlot d={d} gap={leader ? leader.points - d.points : null} leaderPoints={leader?.points ?? null} /></li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            <p className="mt-12 text-[0.875rem] text-[color:var(--bc-titanium)]">Points include sprints. The figure beside the points is the gap to the leader; the bar is the share of the leader&apos;s total.</p>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- archive */}
      <section aria-labelledby="since-title" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-80" />
        <div className="ds-container grid items-end gap-x-10 gap-y-10 lg:grid-cols-12">
          <div data-rv className="lg:col-span-6">
            <Kicker>The archive</Kicker>
            <h2 id="since-title" className="bc-display mt-4 text-[clamp(2.2rem,5vw,4rem)]">Since 1950</h2>
            <p className="mt-4 max-w-[48ch] text-[1.02rem] leading-relaxed text-[color:var(--bc-silver)]">Every driver who started a world championship Grand Prix, searchable by name, each with a race-by-race career.</p>
            <div className="mt-6"><PressLink href="/drivers/champions" variant="ghost">The champions hall <span aria-hidden>→</span></PressLink></div>
          </div>
          <div data-rv className="lg:col-span-6">
            <ArchiveSearch action="/drivers/all" label="Find a driver" placeholder="Fangio, Senna, Hamilton" />
          </div>
        </div>
      </section>
    </CarbonPage>
  );
}

function Fact({ label, value, note, mono, color }: { label: string; value: string; note?: string; mono?: boolean; color?: string }) {
  return (
    <div className="min-w-0 border-white/10 py-5 [&:nth-child(n+2)]:sm:border-l [&:nth-child(n+2)]:sm:pl-6 [&:nth-child(even)]:border-l [&:nth-child(even)]:pl-6 sm:[&:nth-child(even)]:pl-6">
      <dt className="bc-label text-[color:var(--bc-titanium)]">{label}</dt>
      <dd className={mono ? 'bc-mono mt-2 text-[1.6rem] leading-none text-[color:var(--bc-white)]' : 'bc-wide mt-2 text-[clamp(1rem,0.8rem+1.2vw,1.25rem)] leading-tight text-[color:var(--bc-white)]'}>{value}</dd>
      {note && <dd className="mt-1.5 flex items-center gap-2 text-[0.875rem] text-[color:var(--bc-silver)]">{color && <TeamBar color={color} className="h-3" />}{note}</dd>}
    </div>
  );
}
