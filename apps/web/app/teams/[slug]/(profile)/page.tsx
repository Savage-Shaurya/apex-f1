import type { Metadata } from 'next';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';
import { officialBetter, teamRecordNotes } from '@/lib/provider-notes';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { loadConstructor } from '@/components/data/load-constructor';
import { currentTeamParams } from '@/components/teams/data/static-params';
import { loadConstructorChampionshipArchive } from '@/components/data/load-championship-archive';
import { jolpica, mapConstructor } from '@apex/api-client/jolpica';
import { readConstructorWindow, readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { getSeasonContext, recentSeasonWindow } from '@/lib/season';
import { getCalendar } from '@/lib/grid';
import { getStandingsSeason } from '@/lib/grid';
import { getDriverMedia, getTeamMedia } from '@/lib/f1-media';
import { constructorTitlesFromArchive } from '@/lib/constructor-titles';
import { teamColorBySlug } from '@/lib/format';
import '@/components/brand-c/brand-c.css';
import '@/components/teams/carbon/teams.css';
import { DataTable, type Column } from '@/components/ds';
import { AutoRefresh } from '@/components/brand-c/live';
import { PressLink } from '@/components/brand-c/Press';
import { ScrollMotion } from '@/components/brand-c/ScrollMotion';
import { TeamHero } from '@/components/teams/TeamHero';
import { CarStage } from '@/components/teams/carbon/CarStage';
import { Kicker, Readout, Runs } from '@/components/teams/carbon/parts';
import { LineUp, type LineUpDriver } from '@/components/teams/carbon/LineUp';
import { SeasonForm, seasonForm } from '@/components/teams/carbon/SeasonForm';
import { teamSeasons, type TeamSeason } from '@/components/teams/team-stats';
import { championshipHistory, historySummary } from '@/components/teams/championship-history';
import { loadConstructorStandingsArchive } from '@/components/teams/data/standings-archive';
import { PositionChart } from '@/components/teams/PositionChart';
import { getPeopleColours, getPeopleGrid, toRaceRows } from '@/components/drivers/data/people-data';
import { cleanName, formatPoints, regularPair, secureReferenceUrl, teamMateDuel, yearRuns } from '@/components/drivers/people';

export const revalidate = 300;
// ISR: the current season's teams are built ahead (cached from the first visit, kept through a
// provider outage); any other constructor renders on its first visit, then is served from cache
// for `revalidate` seconds.
export async function generateStaticParams() {
  return currentTeamParams();
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const record = await loadConstructor(slug);
  // Only a build-time outage renders a page here (the layout throws at runtime): never indexed.
  if (record.state === 'unavailable') return withSocial({ title: 'Team profile', description: 'Formula 1 constructor profile, temporarily unavailable.', robots: { index: false, follow: true } });
  if (record.state === 'missing') return withSocial({ title: 'Team not found', robots: { index: false, follow: true } });
  const c = mapConstructor(record.raw);
  const name = cleanName(c.name);
  return withSocial({
    title: `${name}: Formula 1 team profile`,
    description: `${name} (${c.nationality}): current standing, car, drivers, team-mate comparison and recent seasons.`,
    alternates: { canonical: `/teams/${c.slug}` },
  });
}

export default async function TeamProfilePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const record = await loadConstructor(slug);
  if (record.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Team profile unavailable" reason="This team's profile can't be shown right now. Please check back in a few minutes." backHref="/teams" backLabel="All teams" />;
  }
  if (record.state === 'missing') notFound();
  const c = mapConstructor(record.raw);
  const name = cleanName(c.name);
  const teamWiki = secureReferenceUrl(c.wikiUrl);

  // Every read that needs only the slug and the season starts at once (PERF2-4). The recent
  // window is keyed by the site's results season, the same season the standings snapshot reports.
  const seasons = await getSeasonContext();
  const years = recentSeasonWindow(seasons.resultsSeason, 3);
  const [standingsRead, grid, gridSeason, colours, windowRead, archive, standingsArchive] = await Promise.all([
    readPublicSport(() => jolpica.getConstructorStandingsSnapshot('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 })),
    getPeopleGrid(),
    getStandingsSeason(),
    getPeopleColours(),
    readConstructorWindow(c.slug, years),
    loadConstructorChampionshipArchive(seasons.lastCompletedSeason),
    loadConstructorStandingsArchive(seasons.resultsSeason, seasons.lastCompletedSeason),
  ]);
  if (standingsRead.state === 'unavailable') await outageConnection();
  const season = standingsRead.state === 'available' && standingsRead.data.season ? Number(standingsRead.data.season) : null;
  const rosterSeason = season ?? seasons.resultsSeason;
  const me = standingsRead.state === 'available' ? standingsRead.data.standings.find((s) => s.Constructor.constructorId === c.slug) ?? null : null;
  const onGrid = gridSeason.season === rosterSeason ? grid.filter((g) => g.teamSlug === c.slug) : [];
  const color = onGrid[0]?.color ?? (teamColorBySlug(c.slug, colours) === teamColorBySlug(null) ? null : teamColorBySlug(c.slug, colours));

  // Car and logo pictures exist only for a team in the current table (F1 media, 2024 onward).
  const [mediaNow, mediaPrev, mediaPrev2] = me && season !== null
    ? await Promise.all([getTeamMedia(season, c.slug), getTeamMedia(season - 1, c.slug), getTeamMedia(season - 2, c.slug)])
    : [null, null, null];
  if (windowRead.state === 'unavailable') await outageConnection();
  const windows = windowRead.state === 'available' ? windowRead.data.map((w) => ({ year: w.year, races: toRaceRows(w.races) })) : [];
  const record3 = teamSeasons(windows);
  const history = championshipHistory(c.slug, standingsArchive.tables);
  const historyAt = historySummary(history);
  // A team that last raced decades ago has no "recent seasons"; its championship record says it all.
  const showRecent = windowRead.state === 'unavailable' || record3.length > 0 || history.length === 0;

  const titleRead = constructorTitlesFromArchive(c.slug, archive);
  const titles = titleRead.state === 'confirmed' ? titleRead.record : null;
  const titlesThrough = titleRead.state === 'confirmed' ? titleRead.record.through : titleRead.through;

  // Team-mate duel for the standings season.
  const current = windows.find((w) => w.year === rosterSeason);
  const pair = current ? regularPair(current.races) : null;
  const duel = pair ? teamMateDuel(current!.races, pair[0], pair[1]) : null;
  const person = async (slugId: string) => {
    const g = onGrid.find((x) => x.slug === slugId) ?? grid.find((x) => x.slug === slugId);
    const fromRows = current?.races.flatMap((r) => r.rows).find((r) => r.driver.slug === slugId)?.driver;
    const firstName = g?.firstName ?? fromRows?.firstName ?? '';
    const lastName = g?.lastName ?? fromRows?.lastName ?? slugId;
    // A driver who has since moved team still has a cut-out in this team's kit for the season.
    const cutout = g && g.teamSlug === c.slug
      ? g.cutout
      : (await getDriverMedia({ season: rosterSeason, constructorId: c.slug, firstName, lastName }))?.cutout ?? null;
    const headshot = g && g.teamSlug === c.slug ? g.headshot : null;
    return { slug: slugId, firstName, lastName, cutout, headshot, points: g && g.teamSlug === c.slug ? g.points : null, position: g && g.teamSlug === c.slug ? g.position : null } satisfies LineUpDriver;
  };
  const duelPeople = pair ? await Promise.all([person(pair[0]), person(pair[1])]) : null;

  // The current car is the hero; this rail shows the cars before it.
  const cars = [
    { year: season !== null ? season - 1 : null, url: mediaPrev?.car ?? null },
    { year: season !== null ? season - 2 : null, url: mediaPrev2?.car ?? null },
  ].filter((x): x is { year: number; url: string } => x.year !== null && Boolean(x.url));

  const roster = new Map<string, { slug: string; name: string; last: number; starts: number }>();
  for (const w of windows) for (const r of w.races) for (const row of r.rows) {
    const e = roster.get(row.driver.slug) ?? { slug: row.driver.slug, name: row.driver.fullName, last: w.year, starts: 0 };
    e.starts++;
    e.last = Math.max(e.last, w.year);
    roster.set(row.driver.slug, e);
  }
  const everyone = Array.from(roster.values()).sort((a, b) => b.last - a.last || b.starts - a.starts);

  const seasonColumns: Column<TeamSeason>[] = [
    { key: 'year', header: 'Season', rowHeader: true, width: '5.5rem', cell: (s) => <span className="font-[650]">{s.year}</span> },
    { key: 'races', header: 'Races', numeric: true, hideBelow: 'sm', cell: (s) => s.races },
    { key: 'wins', header: 'Wins', numeric: true, cell: (s) => s.wins },
    { key: 'podiums', header: 'Podiums', numeric: true, hideBelow: 'md', cell: (s) => s.podiums },
    { key: 'onetwo', header: '1-2s', numeric: true, hideBelow: 'lg', cell: (s) => s.oneTwos },
    { key: 'best', header: 'Best', numeric: true, hideBelow: 'sm', cell: (s) => (s.best !== null ? `P${s.best}` : 'None') },
    { key: 'points', header: 'Points', numeric: true, cell: (s) => formatPoints(s.points) },
  ];

  const calendar = await getCalendar();
  const watch = [calendar.next?.raceStartIso].filter((x): x is string => Boolean(x));
  const teamColor = color ?? '#7a7a84';
  const lineUp: LineUpDriver[] = duelPeople
    ? duelPeople
    : onGrid.map((g) => ({ slug: g.slug, firstName: g.firstName, lastName: g.lastName, cutout: g.cutout, headshot: g.headshot, points: g.points, position: g.position }));
  const form = current ? seasonForm(current.races, c.slug) : [];
  const titlesNote = titles
    ? (titles.titles ? <Runs text={yearRuns(titles.years ?? [])} /> : `None through ${titlesThrough}`)
    : 'Unavailable right now';

  return (
    <div className="bc relative">
      <AutoRefresh everyMs={300_000} watch={watch} />
      <TeamHero
        slug={c.slug}
        tab="profile"
        name={name}
        color={color}
        logo={mediaNow?.logo ?? null}
        car={mediaNow?.car ?? null}
        carAlt={season ? `${name} ${season} car, side view` : `${name} car`}
        crumbs={[{ label: 'Teams', href: '/teams' }, { label: name }]}
        meta={[c.nationality, me ? `${season} season` : 'Not on the current grid'].filter(Boolean)}
        stats={
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {me && <Readout label="Position" value={`P${me.position}`} />}
            {me && <Readout label="Points" value={formatPoints(Number(me.points))} count={Number(me.points)} />}
            {me && <Readout label="Wins" value={me.wins} />}
            <Readout label="Titles" value={titles ? titles.titles : '–'} note={<>{titlesNote}{titles?.titles ? <span className="block text-[color:var(--bc-titanium)]">Through {titlesThrough}</span> : null}</>} />
          </dl>
        }
      />

      {standingsRead.state === 'unavailable' && (
        <p className="ds-container py-6 text-[0.95rem] text-[color:var(--bc-silver)]">The team&apos;s current position and points are unavailable right now. They return here on their own.</p>
      )}

      {lineUp.length > 0 && (
        <section aria-labelledby="lineup-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div className="ds-container">
            <Kicker>{rosterSeason} line-up</Kicker>
            <h2 id="lineup-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">{duel ? 'Team-mates' : 'The drivers'}</h2>
            <div className="mt-10">
              <LineUp drivers={lineUp} duel={duel} color={teamColor} season={rosterSeason} team={name} />
            </div>
          </div>
        </section>
      )}

      {form.length > 0 && (
        <section aria-labelledby="form-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div className="ds-container">
            <Kicker>Season form · {rosterSeason}</Kicker>
            <h2 id="form-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">Round by round</h2>
            <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Readout size="s" label="Rounds" value={form.length} />
              <Readout size="s" label="Points" value={formatPoints(form.reduce((a, r) => a + r.points, 0))} note="Grand Prix only" />
              <Readout size="s" label="Wins" value={form.filter((r) => r.best === 1).length} />
              <Readout size="s" label="Podium rounds" value={form.filter((r) => r.best !== null && r.best <= 3).length} />
            </dl>
            <div className="mt-10">
              <SeasonForm rounds={form} color={teamColor} name={name} season={rosterSeason} />
            </div>
          </div>
        </section>
      )}

      {cars.length > 0 && (
        <section aria-labelledby="cars-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div className="ds-container">
            <Kicker>The garage</Kicker>
            <h2 id="cars-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">Earlier cars</h2>
            <ol className="mt-10 grid grid-cols-1 gap-x-10 gap-y-12 md:grid-cols-2">
              {cars.map((car) => (
                <li key={car.year} data-rv className="group min-w-0">
                  <CarStage src={car.url} alt={`${name} ${car.year} car, side view`} color={color} glare sizes="(max-width: 768px) 92vw, 46vw" />
                  <p className="bc-mono mt-3 text-[1.4rem] text-white">{car.year}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="record-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div className="ds-container">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <Kicker>Championship record</Kicker>
                <h2 id="record-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">{historyAt.seasons} {historyAt.seasons === 1 ? 'season' : 'seasons'}</h2>
                <p className="mt-3 max-w-[56ch] text-[1rem] text-[color:var(--bc-silver)]">In the Constructors&apos; Championship, {historyAt.first === historyAt.last ? historyAt.first : `${historyAt.first}–${historyAt.last}`}.</p>
              </div>
              <PressLink href={`/teams/${c.slug}/history`} variant="ghost">Every season <span aria-hidden>→</span></PressLink>
            </div>
            <dl className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
              <Readout label="Titles" value={titles ? titles.titles : '–'} note={titles ? (titles.titles ? <>Through {titlesThrough}</> : `None through ${titlesThrough}`) : 'Unavailable right now'} />
              <Readout label="Best finish" value={historyAt.best !== null ? `P${historyAt.best}` : 'None'} note={officialBetter(teamRecordNotes(c.slug, history.map((r) => r.year)), historyAt.best) ?? (historyAt.bestCount > 1 ? `${historyAt.bestCount} seasons` : undefined)} />
              <Readout label="Top three" value={historyAt.podiumSeasons} note="Seasons" />
              <Readout label="Wins" value={historyAt.wins} note="In classified seasons" />
            </dl>
            <div className="mt-12">
              <PositionChart rows={history} name={name} />
            </div>
            {teamRecordNotes(c.slug, history.map((r) => r.year)).map((n) => (
              // A known provider error, shown beside the provider's numbers (R3-DATA-4).
              <p key={n.season} role="note" className="mt-4 max-w-[72ch] text-[0.85rem] text-[color:var(--bc-silver)]">Note: {n.line}</p>
            ))}
            {standingsArchive.missing.length > 0 && <p className="mt-4 text-[0.85rem] text-[color:var(--bc-titanium)]">Some seasons can&apos;t be shown right now: {yearRuns(standingsArchive.missing)}.</p>}
          </div>
        </section>
      )}

      <section aria-labelledby={showRecent ? 'seasons-title' : undefined} className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
        <div className="ds-container">
          {showRecent && (
            <>
              <Kicker>{years.at(-1)}–{years[0]}</Kicker>
              <h2 id="seasons-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">Recent seasons</h2>
              <p className="mt-3 text-[1rem] text-[color:var(--bc-silver)]">Both cars, Grand Prix points only.</p>
              <div className="mt-10">
                {windowRead.state === 'unavailable' ? (
                  <p className="text-[color:var(--bc-silver)]">The recent seasons can&apos;t be shown right now. Please check back in a few minutes.</p>
                ) : record3.length === 0 ? (
                  <p className="max-w-[60ch] text-[color:var(--bc-silver)]">{name} has not started a Grand Prix in {years.at(-1)}–{years[0]}.{history.length ? ` Its last Constructors' Championship was ${historyAt.last}; the record above covers every season it was classified.` : ' The full archive of every constructor is in the directory.'}</p>
                ) : (
                  <DataTable caption={`${name} seasons ${years.at(-1)}–${years[0]}`} captionHidden columns={seasonColumns} rows={record3} rowKey={(s) => String(s.year)} accent={(s) => (s.year === rosterSeason ? color : null)} className="[&_table]:min-w-0" />
                )}
              </div>
            </>
          )}
          {everyone.length > 0 && (
            <div className={showRecent ? 'mt-16' : ''}>
              <h3 className="bc-wide text-[1.3rem] text-white">Who drove for {name}</h3>
              <p className="mt-2 text-[0.9rem] text-[color:var(--bc-silver)]">Every driver with a Grand Prix start for the team in these seasons.</p>
              <ul className="mt-6 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {everyone.map((p) => (
                  <li key={p.slug} className="border-b border-[color:var(--bc-rule)]">
                    <Link href={`/drivers/${p.slug}`} className="group/row flex min-h-12 items-center justify-between gap-4 py-2">
                      <span className="break-words font-semibold text-white underline-offset-4 group-hover/row:underline">{p.name}</span>
                      <span className="bc-mono shrink-0 text-[0.82rem] text-[color:var(--bc-titanium)]">{p.starts} {p.starts === 1 ? 'start' : 'starts'} · {p.last}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-12 flex flex-col gap-2 text-[0.88rem] text-[color:var(--bc-silver)]">
            {titles?.viaAliases.length ? <p>Titles include {titles.viaAliases.map((a) => `${cleanName(a.name)} (${a.years.join(', ')})`).join(', ')}.</p> : null}
            {teamWiki && <p><a href={teamWiki} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-white underline underline-offset-4 hover:text-[color:var(--bc-silver)]">{name} on Wikipedia<span className="sr-only"> (opens in a new tab)</span></a></p>}
          </div>
        </div>
      </section>
      <ScrollMotion />
    </div>
  );
}
