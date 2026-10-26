import type { Metadata } from 'next';
import { isPitLaneStart } from '@/lib/format';
import { notFound } from 'next/navigation';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { loadDriver } from '@/components/data/load-driver';
import { loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { jolpica, mapDriver } from '@apex/api-client/jolpica';
import { getWikipediaSummaryByUrl, getDriverFactsByQid } from '@apex/api-client/wikipedia';
import { getF1InfoboxCareer } from '@apex/api-client/wikipedia/infobox';
import { aggregateCareer, careerInputForRace, fastestLapDisplay, FASTEST_LAP_RECORDS_FROM } from '@/lib/career-stats';
import { getCommonsPortrait } from '@/lib/commons-image';
import { getSeasonContext } from '@/lib/season';
import { DataTable, SectorMark, type Column } from '@/components/ds';
import { CarbonPage, Figures, SectionHead } from '@/components/drivers/carbon/primitives';
import { PressLink } from '@/components/brand-c/Press';
import { ProfileHero, type HeroPicture } from '@/components/drivers/ProfileHero';
import { TeamName } from '@/components/drivers/TeamName';
import { ResultCell } from '@/components/drivers/ResultCell';
import { OpenSeasonOnHash } from '@/components/drivers/OpenSeasonOnHash';
import { SeasonPointsChart } from '@/components/drivers/SeasonPointsChart';
import { commonsCredit } from '@/components/drivers/f1-assets';
import { getPeopleColours, getPeopleGrid, liveryFor, toRaceRows } from '@/components/drivers/data/people-data';
import { getStandingsSeason } from '@/lib/grid';
import { careerRecords, careerSeasons, formatPoints, raceLabel, teamsLine, type CareerRace } from '@/components/drivers/people';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';
import { currentSeasonDriverParams } from '@/components/drivers/static-params';

export const revalidate = 300;
// ISR for every path. The current grid is built ahead so it always has a good copy to serve
// if a later revalidation meets a provider outage; any other driver renders on first visit and
// is then served from cache for `revalidate` seconds. Without this export the route renders per request.
export async function generateStaticParams() {
  return currentSeasonDriverParams();
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const record = await loadDriver(slug);
  // Only a build-time outage renders a page here (the layout throws at runtime): never indexed.
  if (record.state === 'unavailable') return withSocial({ title: 'Driver career unavailable', robots: { index: false, follow: true } });
  if (record.state === 'missing') return withSocial({ title: 'Driver not found', robots: { index: false, follow: true } });
  const d = mapDriver(record.raw);
  return withSocial({
    title: `${d.fullName}: every Formula 1 race`,
    description: `${d.fullName}'s complete Formula 1 career, round by round: grid, result, points and fastest laps for every Grand Prix.`,
    alternates: { canonical: `/drivers/${d.slug}/career` },
  });
}

/** Seasons older than this many (newest first) start collapsed. */
const OPEN_SEASONS = 3;

export default async function DriverCareerPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const record = await loadDriver(slug);
  if (record.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Driver career unavailable" reason="This driver's career can't be shown right now. Please check back in a few minutes." backHref="/drivers" backLabel="All drivers" />;
  }
  if (record.state === 'missing') notFound();
  const d = mapDriver(record.raw);

  const [wikiSummary, resultsRead, grid, colours, seasonCtx, table] = await Promise.all([
    d.wikiUrl ? getWikipediaSummaryByUrl(d.wikiUrl, { revalidate: 86400 }) : Promise.resolve(null),
    readPublicSport(() => jolpica.getDriverResults(slug, { ...SPORT_READ_OPTIONS, revalidate: 300 })),
    getPeopleGrid(),
    getPeopleColours(),
    getSeasonContext(),
    getStandingsSeason(),
  ]);
  if (resultsRead.state === 'unavailable') await outageConnection();
  const resultsOk = resultsRead.state === 'available';
  const races = resultsOk ? toRaceRows(resultsRead.data) : [];
  const career = careerSeasons(races, liveryFor(colours, table.season));
  const totals = aggregateCareer(races.map((r) => careerInputForRace(r.season, r.rows)).filter((x): x is NonNullable<typeof x> => x !== null));
  const infobox = resultsOk && totals.fastestLaps.coverage !== 'full' && d.wikiUrl ? await getF1InfoboxCareer(d.wikiUrl, { revalidate: 604_800 }) : null;
  const fastest = fastestLapDisplay(totals, infobox?.fastestLaps);
  const records = careerRecords(career);

  const archive = await loadDriverChampionshipArchive(seasonCtx.lastCompletedSeason);
  const titleYears = archive.records.filter((row) => row.winner.Driver.driverId === d.slug).map((row) => row.year);

  const onGrid = grid.find((g) => g.slug === d.slug) ?? null;
  const latest = career.at(-1);
  const team = onGrid ? { name: onGrid.team, color: onGrid.color } : null;
  let picture: HeroPicture = { kind: 'none' };
  if (onGrid?.cutout) picture = { kind: 'cutout', src: onGrid.cutout, glyph: null };
  else {
    const qidFacts = wikiSummary?.wikidataId ? await getDriverFactsByQid(wikiSummary.wikidataId, { revalidate: 86400 }) : null;
    const photo = await getCommonsPortrait([qidFacts?.imageUrl, wikiSummary?.originalImageUrl, wikiSummary?.thumbnailUrl], d.fullName);
    if (photo) picture = { kind: 'portrait', src: photo.src, credit: commonsCredit(photo.credit) };
  }
  const span = career.length ? (career[0]!.year === latest!.year ? String(latest!.year) : `${career[0]!.year}–${latest!.year}`) : null;

  const raceColumns: Column<CareerRace>[] = [
    { key: 'round', header: 'Rd', width: '3.5rem', cell: (r) => <span className="text-fg-2">{r.round}</span> },
    { key: 'race', header: 'Grand Prix', rowHeader: true, cell: (r) => <span className="flex flex-col"><span className="font-[650]">{raceLabel(r.raceName)}</span><span className="text-small text-fg-3">{r.country}</span></span> },
    { key: 'team', header: 'Team', hideBelow: 'lg', cell: (r) => (r.team ? <span className="[overflow-wrap:normal]">{r.team.name}</span> : 'Not recorded') },
    { key: 'grid', header: 'Grid', numeric: true, hideBelow: 'sm', cell: (r) => (r.grid ? r.grid : isPitLaneStart(r) ? 'Pit lane' : 'None') },
    {
      key: 'result', header: 'Result', numeric: true,
      cell: (r) => <ResultCell race={r} />,
    },
    { key: 'fl', header: 'Fastest lap', align: 'center', hideBelow: 'md', cell: (r) => (r.fastestLap ? <span className="inline-flex items-center gap-2"><SectorMark kind="purple" /><span className="text-small">Fastest</span></span> : r.season < FASTEST_LAP_RECORDS_FROM ? <span className="text-small text-fg-3">Not recorded</span> : <span className="sr-only">No</span>) },
    { key: 'pts', header: 'Points', numeric: true, cell: (r) => formatPoints(r.points) },
  ];

  return (
    <CarbonPage>
      <ProfileHero
        compact
        firstName={d.firstName}
        lastName={d.lastName}
        crumbs={[{ label: 'Drivers', href: '/drivers' }, { label: d.fullName, href: `/drivers/${d.slug}` }, { label: 'Career' }]}
        team={team}
        meta={[d.nationality, span ? `${career.length} ${career.length === 1 ? 'season' : 'seasons'}, ${span}` : '', onGrid ? '' : teamsLine(career)].filter(Boolean)}
        picture={picture}
        teamColor={team?.color ?? null}
        plateYears={span}
        number={onGrid?.number ?? null}
      >
        {resultsOk && career.length > 0 && (
          <Figures items={[
            { label: 'Starts', value: totals.entries },
            { label: 'Wins', value: totals.wins },
            { label: 'Podiums', value: totals.podiums },
            { label: 'P1 starts', value: totals.gridP1Starts },
            { label: 'Fastest laps', value: fastest.value, note: fastest.sub },
            { label: 'Points', value: formatPoints(totals.points), note: 'Grand Prix' },
          ]} />
        )}
      </ProfileHero>

      {!resultsOk ? (
        <section className="ds-container py-16">
          <p className="bc-wide text-[1.3rem]">Career data unavailable</p>
          <p className="mt-2 max-w-[56ch] text-[color:var(--bc-silver)]">The race-by-race history can&apos;t be shown right now. It returns here on its own.</p>
          <div className="mt-6"><PressLink href={`/drivers/${d.slug}`} variant="ghost">Back to the profile</PressLink></div>
        </section>
      ) : career.length === 0 ? (
        <section className="ds-container py-16"><p className="text-[color:var(--bc-silver)]">No Grand Prix results are on record for {d.fullName}.</p></section>
      ) : (
        <>
          <section aria-labelledby="points-title" className="py-16 lg:py-24">
            <div className="ds-container grid gap-x-12 gap-y-12 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
                <SectionHead id="points-title" kicker="Season by season" title="Points by season" />
                <div data-rv className="mt-8 rounded-2xl bg-[#08080a] p-4 ring-1 ring-white/10 sm:p-6">
                  <SeasonPointsChart seasons={career.map((s) => ({ year: s.year, points: s.points, color: s.teams[0]?.color }))} titleYears={titleYears} name={d.fullName} />
                </div>
              </div>
              <div className="min-w-0 lg:col-span-4">
                <SectionHead kicker="Milestones" title="Records" />
                <dl data-rv className="mt-8 flex flex-col border-t border-white/10">
                  <Record label="First win" value={records.firstWin ? `${records.firstWin.season} ${raceLabel(records.firstWin.raceName)}` : 'No wins'} />
                  <Record label="First start from P1" value={records.firstStartP1 ? `${records.firstStartP1.season} ${raceLabel(records.firstStartP1.raceName)}` : 'Never started from P1'} />
                  <Record label="Most wins in a season" value={records.bestSeason ? `${records.bestSeason.wins} in ${records.bestSeason.year}` : 'No wins'} />
                  <Record label="Longest run in the points" value={records.longestPointsStreak ? `${records.longestPointsStreak} ${records.longestPointsStreak === 1 ? 'Grand Prix' : 'Grands Prix in a row'}` : 'Never scored'} />
                  {titleYears.length > 0 && <Record label="World titles" value={titleYears.slice().sort((a, b) => a - b).join(', ')} />}
                </dl>
              </div>
            </div>
          </section>

          <section aria-labelledby="seasons-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
            <div className="ds-container">
              <SectionHead id="seasons-title" kicker="Every Grand Prix" title="Round by round" lead="Newest season first. Older seasons are folded; open any season to read its rounds. Points are Grand Prix points; sprint races are not included." />
              <OpenSeasonOnHash />
              <ol className="mt-10 flex flex-col">
                {career.slice().reverse().map((s, i) => (
                  <li key={s.year} id={`season-${s.year}`} className="scroll-mt-24 border-t border-white/10">
                    <details open={i < OPEN_SEASONS} className="group/season">
                      <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-5 [&::-webkit-details-marker]:hidden md:grid-cols-[7rem_minmax(9rem,1fr)_repeat(3,4.5rem)_auto] lg:grid-cols-[8.5rem_minmax(12rem,1fr)_repeat(4,5.5rem)_auto]">
                        <span className="bc-mono whitespace-nowrap text-[clamp(1.6rem,3vw,2.4rem)] leading-none text-[color:var(--bc-white)]">{s.year}</span>
                        <span className="flex min-w-0 flex-col gap-1">
                          {s.teams.map((t) => <TeamName key={t.slug} color={t.color} name={t.name} className="text-[0.95rem] font-semibold text-[color:var(--bc-white)]" />)}
                          {titleYears.includes(s.year) && <span className="bc-label text-[color:var(--bc-white)]">World champion</span>}
                        </span>
                        <SummaryStat label="Starts" value={s.starts} />
                        <SummaryStat label="Wins" value={s.wins} />
                        <SummaryStat label="Best" value={s.best !== null ? `P${s.best}` : 'None'} from="lg" />
                        <SummaryStat label="Points" value={formatPoints(s.points)} />
                        <span className="inline-flex size-11 items-center justify-center justify-self-end rounded-full text-[color:var(--bc-silver)] ring-1 ring-white/15 transition-transform duration-300 group-open/season:rotate-180 motion-reduce:transition-none" aria-hidden>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square"><path d="M6 9l6 6 6-6" /></svg>
                        </span>
                        <span className="sr-only">{`${s.year}: ${s.starts} starts, ${s.wins} wins, ${formatPoints(s.points)} points`}</span>
                      </summary>
                      <div className="pb-10">
                        <DataTable
                          caption={`${s.year} Grand Prix results for ${d.fullName}`}
                          captionHidden
                          columns={raceColumns}
                          rows={s.races}
                          rowKey={(r) => `${r.season}-${r.round}`}
                          density="compact"
                          width="full"
                          className="[&_table]:min-w-0"
                        />
                      </div>
                    </details>
                  </li>
                ))}
              </ol>
              <div className="mt-10 flex flex-col gap-5">
                <p className="text-[0.875rem] text-[color:var(--bc-titanium)]">Race-by-race fastest laps are recorded from {FASTEST_LAP_RECORDS_FROM}.{infobox?.fastestLaps != null && totals.fastestLaps.coverage !== 'full' ? ' The career fastest-lap total covers every season.' : ''}</p>
                <div><PressLink href={`/drivers/${d.slug}`} variant="ghost"><span aria-hidden>←</span> Back to {d.lastName}&apos;s profile</PressLink></div>
              </div>
            </div>
          </section>
        </>
      )}
    </CarbonPage>
  );
}

function Record({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/10 py-4">
      <dt className="bc-label text-[color:var(--bc-titanium)]">{label}</dt>
      <dd className="mt-1.5 text-[1rem] font-semibold text-[color:var(--bc-white)]">{value}</dd>
    </div>
  );
}

function SummaryStat({ label, value, from = 'md' }: { label: string; value: string | number; from?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={`hidden flex-col items-end ${from === 'lg' ? 'lg:flex' : 'md:flex'}`}>
      <span className="bc-label text-[color:var(--bc-titanium)]">{label}</span>
      <span className="bc-mono text-[0.95rem] text-[color:var(--bc-white)]">{value}</span>
    </span>
  );
}

