import type { Metadata } from 'next';
import { withSocial } from '@/lib/page-metadata';
import { driversForTeam, loadTeamSplits } from '@/lib/team-drivers';
import '@/components/brand-c/brand-c.css';
import '@/components/teams/carbon/teams.css';
import { getCalendar, getConstructorStandings, getConstructorStandingsSeason, getStandingsSeason } from '@/lib/grid';
import { getTeamMedia } from '@/lib/f1-media';
import { teamColorBySlug } from '@/lib/format';
import { getPeopleColours, getPeopleGrid } from '@/components/drivers/data/people-data';
import { cleanName, formatPoints } from '@/components/drivers/people';
import { Floodlights } from '@/components/brand-c/stages';
import { AutoRefresh } from '@/components/brand-c/live';
import { WrittenLine } from '@/components/brand-c/WrittenLine';
import { PressLink } from '@/components/brand-c/Press';
import { ScrollMotion } from '@/components/brand-c/ScrollMotion';
import { TeamPanel, type TeamPanelData } from '@/components/teams/TeamPanel';
import { CarStage } from '@/components/teams/carbon/CarStage';
import { Ladder } from '@/components/teams/carbon/Ladder';
import { fitDisplay, Kicker } from '@/components/teams/carbon/parts';

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const [table, standings] = await Promise.all([getConstructorStandingsSeason(), getConstructorStandings()]);
  const leader = standings[0];
  return withSocial({
    title: table.season ? `${table.season} Formula 1 teams` : 'Formula 1 teams',
    description: table.season && leader
      ? `The ${standings.length} constructors of the ${table.season} Formula 1 season in championship order, led by ${cleanName(leader.constructor.name)} on ${formatPoints(leader.points)} points, with each team's car and drivers.`
      : 'The current Formula 1 constructors in championship order.',
    alternates: { canonical: '/teams' },
  });
}

/**
 * The current constructors, Carbon & Light. The first screen answers who
 * leads and by how much (from the published points) with the leader's car
 * under the floodlights and the whole table as a ladder; then one lit bay
 * per team in championship order. The page re-reads its data on its own
 * every five minutes and just after the next Grand Prix starts.
 */
export default async function TeamsIndexPage() {
  const [standings, table, gridSeason, gridRead, colours, calendar] = await Promise.all([
    getConstructorStandings(),
    getConstructorStandingsSeason(),
    getStandingsSeason(),
    getPeopleGrid(),
    getPeopleColours(),
    getCalendar(),
  ]);
  const season = table.season;
  const grid = season !== null && gridSeason.season === season ? gridRead : [];
  const [media, splits] = await Promise.all([
    Promise.all(standings.map((s) => getTeamMedia(season, s.constructor.slug))),
    loadTeamSplits(season, grid),
  ]);
  const leader = standings[0];
  const second = standings[1];
  const seasonRaces = season !== null && calendar.season === season ? calendar.races.length : 0;
  const round = table.round;
  const roundsLeft = seasonRaces && round ? Math.max(0, seasonRaces - round) : null;
  const watch = [calendar.next?.raceStartIso].filter((x): x is string => Boolean(x));

  const panels: TeamPanelData[] = standings.map((s, i) => {
    // Everyone who raced for the team this season, with the points scored for it (R3-DATA-1).
    const entries = driversForTeam(s.constructor.slug, grid, splits);
    const drivers = entries.filter((e) => e.current).map((e) => e.driver);
    return {
      slug: s.constructor.slug,
      name: cleanName(s.constructor.name),
      color: drivers[0]?.color ?? teamColorBySlug(s.constructor.slug, colours),
      position: s.position,
      points: s.points,
      wins: s.wins,
      gap: i === 0 || !leader ? null : leader.points - s.points,
      leaderPoints: leader?.points ?? 0,
      car: media[i]?.car ?? null,
      logo: media[i]?.logo ?? null,
      season,
      // A driver's portrait is in his current team's kit, so it is shown only on that team's card.
      drivers: entries.map(({ driver: d, points, current, shared }) => ({ slug: d.slug, firstName: d.firstName, lastName: d.lastName, cutout: current ? d.cutout : null, headshot: current ? d.headshot : null, points, shared })),
    };
  });
  const top = panels[0];
  const gap = leader && second ? leader.points - second.points : null;
  const line = top && second && gap !== null
    ? gap === 0 ? `${top.name} and ${cleanName(second.constructor.name)} level` : `${top.name} lead by ${formatPoints(gap)}`
    : null;
  const stateText = table.previousSeasonFinal ? 'Final standings' : round ? `After round ${round}${seasonRaces ? ` of ${seasonRaces}` : ''}` : null;

  return (
    <div className="bc relative">
      <AutoRefresh everyMs={300_000} watch={watch} />
      <section aria-labelledby="teams-title" className="relative isolate overflow-hidden">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <Floodlights className="pointer-events-none absolute inset-y-0 -left-[10%] -right-[10%] -z-10 lg:left-[38%] lg:-right-[8%] [&>div]:absolute [&>div]:inset-0" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
        <div className="ds-container grid grid-cols-1 gap-y-8 pb-14 pt-10 md:pt-14 lg:grid-cols-12 lg:gap-x-10 lg:pb-20 lg:pt-16">
          <div className="min-w-0 lg:col-span-5 lg:row-start-1">
            <Kicker className="bc-in-up">
              <span>Constructors&apos; championship</span>
              {stateText && <><span aria-hidden className="text-[color:var(--bc-titanium)]">/</span><span>{stateText}</span></>}
            </Kicker>
            <div className="mt-5 [container-type:inline-size]">
              <h1 id="teams-title" className="bc-display text-[color:var(--bc-white)]" style={{ fontSize: fitDisplay('Constructors', 'clamp(2.6rem, 1.4rem + 4.4vw, 5.6rem)') }}>
                {season ? <><span className="bc-mono block text-[0.42em] font-medium tracking-[0.06em] text-[color:var(--bc-silver)]">{season}</span>Constructors</> : 'Constructors'}
              </h1>
            </div>
            {line ? (
              <>
                <WrittenLine as="h2" text={line} className="bc-wide mt-6 text-[clamp(1.25rem,2.2vw,1.8rem)] leading-tight text-white" />
                <p className="mt-3 max-w-[46ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">
                  {top!.name} {gap === 0 ? 'are level with' : 'lead'} {cleanName(second!.constructor.name)}{gap ? <> by <span className="bc-mono text-white">{formatPoints(gap)}</span> points</> : ''} with <span className="bc-mono text-white">{top!.wins}</span> {top!.wins === 1 ? 'win' : 'wins'}{roundsLeft !== null ? <>; <span className="bc-mono text-white">{roundsLeft}</span> {roundsLeft === 1 ? 'round' : 'rounds'} to go</> : ''}.
                </p>
              </>
            ) : (
              <p className="mt-6 max-w-[46ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">
                {table.state === 'unavailable' ? 'The constructor standings are unavailable right now. They return here on their own.' : 'No constructor standings have been published for this season yet.'}
              </p>
            )}
            <div className="mt-7 flex flex-wrap gap-3">
              <PressLink href="/teams/champions" variant="solid">Constructor champions <span aria-hidden>→</span></PressLink>
              <PressLink href="/teams/all" variant="ghost">Every constructor since 1950</PressLink>
            </div>
          </div>
          {top && (
            <div className="min-w-0 lg:col-span-7 lg:row-span-2 lg:row-start-1 lg:self-center">
              <CarStage src={top.car} alt={season ? `${top.name} ${season} car, side view` : `${top.name} car, side view`} color={top.color} priority sizes="(max-width: 1024px) 96vw, 58vw" />
              <p className="bc-label mt-3 text-center text-[color:var(--bc-titanium)]">Leader · {top.name}{season ? ` · ${season} car` : ''}</p>
            </div>
          )}
          {panels.length > 0 && (
            <div className="min-w-0 lg:col-span-5 lg:row-start-2">
              <Ladder caption={`${season ?? 'Current'} constructors' standings${stateText ? `, ${stateText.toLowerCase()}` : ''}`} rows={panels.map((p) => ({ slug: p.slug, name: p.name, color: p.color, position: p.position, points: p.points }))} />
            </div>
          )}
        </div>
      </section>

      {panels.length === 0 ? (
        <section className="ds-container border-t border-[color:var(--bc-rule)] py-16">
          <h2 className="bc-wide text-[1.6rem] text-white">Constructor standings unavailable</h2>
          <p className="mt-3 max-w-[56ch] text-[color:var(--bc-silver)]">
            {table.state === 'unavailable' ? "The standings can't be shown right now. Every constructor since 1950 is still a search away." : 'The season has no classified round yet.'}
          </p>
          <div className="mt-6"><PressLink href="/teams/all" variant="ghost">Search every constructor</PressLink></div>
        </section>
      ) : (
        <ol aria-label="Constructors in championship order" className="flex flex-col">
          {panels.map((t, i) => (
            <li key={t.slug}>
              <TeamPanel t={t} priority={i === 0} />
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="since-title" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)]">
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10 opacity-70" />
        <div className="ds-container grid grid-cols-1 items-end gap-8 py-20 lg:grid-cols-12 lg:py-28">
          <div data-rv className="lg:col-span-8">
            <Kicker>The record</Kicker>
            <div className="mt-4 [container-type:inline-size]">
              <h2 id="since-title" className="bc-display text-white" style={{ fontSize: fitDisplay('The constructors since 1950', 'clamp(2rem, 5vw, 4rem)') }}>The constructors since 1950</h2>
            </div>
            <p className="mt-4 max-w-[56ch] text-[1.02rem] leading-relaxed text-[color:var(--bc-silver)]">Every team that entered a world championship Grand Prix, and every Constructors&apos; Champion since the title was first awarded in 1958.</p>
          </div>
          <div data-rv className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
            <PressLink href="/teams/all" variant="solid">All constructors <span aria-hidden>→</span></PressLink>
            <PressLink href="/teams/champions" variant="ghost">Champions</PressLink>
          </div>
        </div>
      </section>
      <ScrollMotion />
    </div>
  );
}
