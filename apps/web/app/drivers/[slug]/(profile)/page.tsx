import type { Metadata } from 'next';
import { isPitLaneStart } from '@/lib/format';
import { notFound } from 'next/navigation';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { loadDriver } from '@/components/data/load-driver';
import { loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { readConstructorWindow, readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { siteOrigin } from '@/components/shell/site-metadata';
import { jolpica, mapDriver } from '@apex/api-client/jolpica';
import { getDriverFactsFromWikidata } from '@apex/api-client/wikidata';
import { safeJsonLd } from '@/lib/json-ld';
import { getWikipediaSummaryByUrl, getDriverFactsByQid } from '@apex/api-client/wikipedia';
import { getF1InfoboxCareer } from '@apex/api-client/wikipedia/infobox';
import { getStandingsSeason } from '@/lib/grid';
import { currentDriverAge, getSeasonContext } from '@/lib/season';
import { aggregateCareer, careerInputForRace, fastestLapDisplay } from '@/lib/career-stats';
import { getCommonsPortrait } from '@/lib/commons-image';
import { getDriverMedia } from '@/lib/f1-media';
import { DataTable, Media, type Column } from '@/components/ds';
import { CarbonPage, Figures, SectionHead } from '@/components/drivers/carbon/primitives';
import { PressLink } from '@/components/brand-c/Press';
import { DriverDuel } from '@/components/drivers/DriverDuel';
import { ProfileHero, type HeroPicture } from '@/components/drivers/ProfileHero';
import { CareerHeatmap } from '@/components/drivers/CareerHeatmap';
import { commonsCredit, numberGlyph } from '@/components/drivers/f1-assets';
import { getPeopleColours, getPeopleGrid, liveryFor, toRaceRows } from '@/components/drivers/data/people-data';
import { TeamName } from '@/components/drivers/TeamName';
import { ResultCell } from '@/components/drivers/ResultCell';
import { careerSeasons, formatPoints, placeLabel, raceLabel, regularPair, secureReferenceUrl, teamMateDuel, teamsLine, yearRuns, type CareerRace, type CareerSeason } from '@/components/drivers/people';
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
  // An outage is answered with a 5xx by the [slug] layout, so it is never indexed; only a confirmed miss is noindex.
  // Only a build-time outage renders a page here (the layout throws at runtime): never indexed.
  if (record.state === 'unavailable') return withSocial({ title: 'Driver profile unavailable', robots: { index: false, follow: true } });
  if (record.state === 'missing') return withSocial({ title: 'Driver not found', robots: { index: false, follow: true } });
  const d = mapDriver(record.raw);
  return withSocial({
    title: `${d.fullName}: Formula 1 driver profile`,
    description: `${d.fullName} (${d.nationality}): career record, every Grand Prix by season, team-mate comparison and biography.`,
    alternates: { canonical: `/drivers/${d.slug}` },
  });
}

export default async function DriverProfilePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const record = await loadDriver(slug);
  if (record.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Driver profile unavailable" reason="This driver's profile can't be shown right now. Please check back in a few minutes." backHref="/drivers" backLabel="All drivers" />;
  }
  if (record.state === 'missing') notFound();
  const d = mapDriver(record.raw);
  // Jolpica keeps http:// Wikipedia links; every outgoing reference uses https (SEO-9).
  const wikiHref = secureReferenceUrl(d.wikiUrl);

  const [wikiSummary, resultsRead, grid, seasons, colours, table] = await Promise.all([
    d.wikiUrl ? getWikipediaSummaryByUrl(d.wikiUrl, { revalidate: 86400 }) : Promise.resolve(null),
    readPublicSport(() => jolpica.getDriverResults(slug, { ...SPORT_READ_OPTIONS, revalidate: 300 })),
    getPeopleGrid(),
    getSeasonContext(),
    getPeopleColours(),
    getStandingsSeason(),
  ]);
  if (resultsRead.state === 'unavailable') await outageConnection();
  const resultsOk = resultsRead.state === 'available';
  const races = resultsOk ? toRaceRows(resultsRead.data) : [];

  const wdFacts = wikiSummary?.wikidataId ? await getDriverFactsByQid(wikiSummary.wikidataId, { revalidate: 86400 }) : null;
  const legacyFacts = !wdFacts && !wikiSummary ? await getDriverFactsFromWikidata(d.fullName, { revalidate: 86400 }) : null;
  const facts = {
    qid: wdFacts?.qid ?? legacyFacts?.qid,
    dob: wdFacts?.dob ?? legacyFacts?.dob,
    pob: placeLabel(wdFacts?.placeOfBirth ?? legacyFacts?.pob),
    height: wdFacts?.heightM ?? legacyFacts?.height,
    image: wdFacts?.imageUrl ?? legacyFacts?.image,
  };

  const career = careerSeasons(races, liveryFor(colours, table.season));
  const careerInputs = races.map((r) => careerInputForRace(r.season, r.rows)).filter((x): x is NonNullable<typeof x> => x !== null);
  const totals = aggregateCareer(careerInputs);
  const infobox = resultsOk && totals.fastestLaps.coverage !== 'full' && d.wikiUrl ? await getF1InfoboxCareer(d.wikiUrl, { revalidate: 604_800 }) : null;
  const fastest = fastestLapDisplay(totals, infobox?.fastestLaps);
  const first = career[0];
  const latest = career.at(-1);

  const onGrid = grid.find((g) => g.slug === d.slug) ?? null;
  // Historic drivers get no single team mark (their last team in today's colours would mislead); the hero lists their teams instead.
  const team = onGrid ? { name: onGrid.team, color: onGrid.color, slug: onGrid.teamSlug } : null;
  const teamColor = team?.color ?? null;
  const carNumber = d.number ?? onGrid?.number ?? null;

  const titleArchive = await loadDriverChampionshipArchive(seasons.lastCompletedSeason);
  const titleYears = titleArchive.records.filter((row) => row.winner.Driver.driverId === d.slug).map((row) => row.year);
  const titlesKnown = titleArchive.state !== 'unavailable';

  // Commons photograph: the hero for historic drivers, the biography picture for current ones.
  const photo = await getCommonsPortrait([facts.image, wikiSummary?.originalImageUrl, wikiSummary?.thumbnailUrl], d.fullName);
  const picture: HeroPicture = onGrid?.cutout
    ? { kind: 'cutout', src: onGrid.cutout, glyph: numberGlyph(onGrid.cutout) }
    : photo
      ? { kind: 'portrait', src: photo.src, credit: commonsCredit(photo.credit) }
      : { kind: 'none' };

  // Team-mate duel for the current season (finished Grands Prix only, from Jolpica).
  let duel = null as ReturnType<typeof teamMateDuel>;
  let mate = null as (typeof grid)[number] | null;
  let mateFallback: { slug: string; firstName: string; lastName: string } | null = null;
  let mateCutout: string | null = null;
  if (onGrid && table.season) {
    const windowRead = await readConstructorWindow(onGrid.teamSlug, [table.season]);
    if (windowRead.state === 'available') {
      const teamRaces = toRaceRows(windowRead.data.flatMap((s) => s.races));
      const starts = new Map<string, { n: number; first: string; last: string }>();
      for (const r of teamRaces) for (const row of r.rows) if (row.driver.slug !== d.slug) {
        const e = starts.get(row.driver.slug) ?? { n: 0, first: row.driver.firstName ?? '', last: row.driver.lastName ?? row.driver.fullName };
        e.n++;
        starts.set(row.driver.slug, e);
      }
      const pair = regularPair(teamRaces);
      const mateSlug = pair?.includes(d.slug) ? pair.find((s) => s !== d.slug)! : Array.from(starts.entries()).sort((x, y) => y[1].n - x[1].n)[0]?.[0];
      if (mateSlug) {
        duel = teamMateDuel(teamRaces, d.slug, mateSlug);
        mate = grid.find((g) => g.slug === mateSlug) ?? null;
        const s = starts.get(mateSlug);
        mateFallback = { slug: mateSlug, firstName: s?.first ?? '', lastName: s?.last ?? mateSlug };
        // A team-mate who has since moved team still has a cut-out in this team's kit for the season.
        mateCutout = mate?.teamSlug === onGrid.teamSlug
          ? mate.cutout
          : (await getDriverMedia({ season: table.season, constructorId: onGrid.teamSlug, firstName: mate?.firstName ?? mateFallback.firstName, lastName: mate?.lastName ?? mateFallback.lastName }))?.cutout ?? null;
      }
    }
  }

  const thisSeason = onGrid && latest && latest.year === table.season ? latest : null;
  const age = currentDriverAge({ dob: d.dob, onCurrentGrid: onGrid !== null, latestSeason: latest?.year, resultsSeason: seasons.resultsSeason, now: seasons.now });
  const born = d.dob || facts.dob || null;
  const bornText = born ? new Date(born).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null;
  const heightDecimals = facts.height ? Math.min(2, (String(facts.height).split('.')[1] ?? '').length) : 0;
  const span = first && latest ? (first.year === latest.year ? String(first.year) : `${first.year}–${latest.year}`) : null;

  const recent: CareerRace[] = career.flatMap((s) => s.races).slice(-5).reverse();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: d.fullName,
    givenName: d.firstName,
    familyName: d.lastName,
    nationality: d.nationality,
    birthDate: d.dob || undefined,
    sameAs: [wikiHref, facts.qid && `https://www.wikidata.org/wiki/${facts.qid}`].filter(Boolean),
    url: `${siteOrigin()}/drivers/${d.slug}`,
    // Commons portraits render from Apex's own /media/commons/ path; structured data needs an absolute URL.
    image: onGrid?.cutout ?? (photo?.src.startsWith('/') ? `${siteOrigin()}${photo.src}` : photo?.src),
  };

  const seasonColumns: Column<CareerSeason>[] = [
    {
      key: 'year', header: 'Season', rowHeader: true, width: '6.5rem',
      cell: (s) => (
        <span className="flex flex-col">
          <span className="font-[650]">{s.year}</span>
          {titleYears.includes(s.year) && <span className="font-text text-label uppercase text-fg-2">Champion</span>}
        </span>
      ),
    },
    { key: 'team', header: 'Team', cell: (s) => <span className="flex flex-col gap-1">{s.teams.map((t) => <TeamName key={t.slug} color={t.color} name={t.name} />)}</span> },
    { key: 'starts', header: 'Starts', numeric: true, hideBelow: 'sm', cell: (s) => s.starts },
    { key: 'wins', header: 'Wins', numeric: true, cell: (s) => s.wins },
    { key: 'podiums', header: 'Podiums', numeric: true, hideBelow: 'md', cell: (s) => s.podiums },
    { key: 'best', header: 'Best', numeric: true, hideBelow: 'sm', cell: (s) => (s.best !== null ? `P${s.best}` : 'None') },
    { key: 'points', header: 'GP points', numeric: true, cell: (s) => formatPoints(s.points) },
  ];

  const recentColumns: Column<CareerRace>[] = [
    { key: 'race', header: 'Grand Prix', rowHeader: true, cell: (r) => <span className="flex flex-col"><span className="font-[650]">{raceLabel(r.raceName)}</span><span className="text-small text-fg-3">{r.season}, round {r.round}</span></span> },
    { key: 'grid', header: 'Grid', numeric: true, hideBelow: 'sm', cell: (r) => (r.grid ? `P${r.grid}` : isPitLaneStart(r) ? 'Pit lane' : 'None') },
    { key: 'finish', header: 'Result', numeric: true, cell: (r) => <ResultCell race={r} /> },
    {
      key: 'delta', header: 'Places', numeric: true, hideBelow: 'md',
      cell: (r) => {
        if (r.finish === null || !r.grid) return <span className="text-fg-3">None</span>;
        const delta = r.grid - r.finish;
        return delta === 0 ? <span className="text-fg-2">Held</span> : <span className={delta > 0 ? 'text-positive' : 'text-negative'}>{delta > 0 ? `Up ${delta}` : `Down ${-delta}`}</span>;
      },
    },
    { key: 'pts', header: 'Points', numeric: true, cell: (r) => formatPoints(r.points) },
  ];

  const winRate = totals.entries > 0 ? Math.round((totals.wins / totals.entries) * 1000) / 10 : null;

  return (
    <CarbonPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />

      <ProfileHero
        firstName={d.firstName}
        lastName={d.lastName}
        crumbs={[{ label: 'Drivers', href: '/drivers' }, { label: d.fullName }]}
        team={team ? { name: team.name, color: team.color, href: team.slug ? `/teams/${team.slug}` : null } : null}
        meta={[carNumber !== null ? `No. ${carNumber}` : '', d.nationality, onGrid ? '' : span ? `Raced ${span}` : '', onGrid ? '' : teamsLine(career)].filter(Boolean)}
        description={wikiSummary?.description}
        picture={picture}
        teamColor={teamColor}
        plateYears={span}
        number={onGrid ? carNumber : null}
      >
        {thisSeason && onGrid ? (
          <Figures items={[
            { label: `${thisSeason.year} position`, value: `P${onGrid.position}` },
            { label: 'Points', value: onGrid.points, decimals: onGrid.points % 1 ? 1 : 0, note: 'With sprints' },
            { label: 'Wins', value: onGrid.wins },
            { label: 'Podiums', value: thisSeason.podiums },
            { label: 'P1 starts', value: thisSeason.races.filter((r) => r.grid === 1).length },
            { label: 'Best finish', value: thisSeason.best !== null ? `P${thisSeason.best}` : 'None' },
          ]} />
        ) : resultsOk && career.length > 0 ? (
          <Figures items={[
            { label: 'Titles', value: titlesKnown ? titleYears.length : 'n/a' },
            { label: 'Starts', value: totals.entries },
            { label: 'Wins', value: totals.wins },
            { label: 'Seasons', value: career.length },
          ]} />
        ) : null}
      </ProfileHero>

      <section aria-labelledby="career-title" className="relative py-16 lg:py-24">
        <div className="ds-container">
          <SectionHead
            id="career-title"
            kicker={span && resultsOk ? `${career.length} ${career.length === 1 ? 'season' : 'seasons'} · ${span}` : 'Career'}
            title="Career record"
            lead={resultsOk && career.length ? 'Grand Prix results only; sprint races are not counted.' : undefined}
          >
            <PressLink href={`/drivers/${d.slug}/career`} variant="ghost">Every race, round by round <span aria-hidden>→</span></PressLink>
          </SectionHead>
          {!resultsOk ? (
            <div className="mt-10 max-w-[48rem] rounded-2xl p-6 ring-1 ring-white/10">
              <p className="bc-wide text-[1.2rem]">Career data unavailable</p>
              <p className="mt-2 text-[color:var(--bc-silver)]">The career record can&apos;t be shown right now. It returns here on its own.</p>
            </div>
          ) : career.length === 0 ? (
            <p className="mt-10 text-[color:var(--bc-silver)]">No Grand Prix results are on record for {d.fullName}.</p>
          ) : (
            <>
              <div data-rv className="mt-10 md:mt-12">
                <Figures items={[
                  { label: 'World titles', value: titlesKnown ? titleYears.length : 'n/a', note: titlesKnown ? (titleYears.length ? yearRuns(titleYears) : `Through ${titleArchive.through}`) : 'Archive unavailable' },
                  { label: 'Starts', value: totals.entries },
                  { label: 'Wins', value: totals.wins, note: winRate !== null ? `${winRate}% of starts` : null },
                  { label: 'Podiums', value: totals.podiums },
                  { label: 'P1 starts', value: totals.gridP1Starts, note: 'From the front of the grid' },
                  { label: 'Fastest laps', value: fastest.value, note: fastest.sub },
                  { label: 'Points', value: formatPoints(totals.points), note: 'Grand Prix points' },
                ]} />
              </div>
              <div data-rv className="mt-14 md:mt-16">
                <h3 className="bc-wide text-[1.25rem]">Every Grand Prix</h3>
                <div className="mt-6 rounded-2xl bg-[#08080a] p-4 ring-1 ring-white/10 sm:p-6">
                  <CareerHeatmap seasons={career} name={d.fullName} careerHref={`/drivers/${d.slug}/career`} />
                </div>
              </div>
              <div data-rv className="mt-14 md:mt-16">
                <DataTable
                  caption={<span className="bc-wide text-[1.25rem] text-[color:var(--bc-white)]">Season by season</span>}
                  columns={seasonColumns}
                  rows={career.slice().reverse()}
                  rowKey={(s) => String(s.year)}
                  accent={(s) => s.teams[0]?.color}
                  className="[&_table]:min-w-0"
                />
                <p className="mt-3 text-[0.875rem] text-[color:var(--bc-titanium)]">Grand Prix points only; sprint points are not included, so the current season can read lower than the championship table.{titleYears.length > 0 ? ' Seasons marked Champion are world titles.' : ''}</p>
              </div>
            </>
          )}
        </div>
      </section>

      {duel && onGrid && table.season && mateFallback && (
        <section aria-labelledby="duel-title" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
          <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-60" />
          <div className="ds-container">
            <DriverDuel
              headingId="duel-title"
              duel={duel}
              season={table.season}
              team={onGrid.team}
              a={{ slug: d.slug, firstName: d.firstName, lastName: d.lastName, cutout: onGrid.cutout, color: onGrid.color }}
              b={{ slug: mateFallback.slug, firstName: mate?.firstName ?? mateFallback.firstName, lastName: mate?.lastName ?? mateFallback.lastName, cutout: mateCutout, color: onGrid.color }}
            />
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="form-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-20">
          <div className="ds-container grid gap-x-10 gap-y-8 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHead id="form-title" kicker="Newest first" title="Recent form" lead="The last five Grands Prix on record." />
            </div>
            <div data-rv className="min-w-0 lg:col-span-8">
              <DataTable caption="Last five Grand Prix results" captionHidden columns={recentColumns} rows={recent} rowKey={(r) => `${r.season}-${r.round}`} accent={(r) => r.team?.color} className="[&_table]:min-w-0" />
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="bio-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-24">
        <div className="ds-container">
          {(() => {
            const bioPhoto = picture.kind === 'cutout' && photo ? photo : null;
            const fact = (label: string, value: string, note?: string | null) => (
              <div className="min-w-0 border-b border-white/10 py-4">
                <dt className="bc-label text-[color:var(--bc-titanium)]">{label}</dt>
                <dd className="mt-1.5 text-[1.05rem] font-semibold text-[color:var(--bc-white)]">{value}</dd>
                {note && <dd className="mt-1 text-[0.875rem] text-[color:var(--bc-silver)]">{note}</dd>}
              </div>
            );
            const factSheet = (
              <dl className="grid grid-cols-1 gap-x-8 border-t border-white/10 sm:grid-cols-2">
                {fact('Born', bornText ?? 'Not recorded', age ? `Age ${age}` : null)}
                {fact('Birthplace', facts.pob ?? 'Not recorded')}
                {fact('Nationality', d.nationality)}
                {fact('Height', facts.height ? `${Number(facts.height).toFixed(heightDecimals)} m` : 'Not recorded')}
              </dl>
            );
            const story = (
              <>
                <SectionHead id="bio-title" kicker="The person" title="Biography" />
                {wikiSummary?.extract ? (
                  <>
                    <p className="bc-serif mt-6 max-w-[62ch] text-[clamp(1.15rem,1.6vw,1.35rem)] leading-relaxed text-[color:var(--bc-silver)]">{wikiSummary.extract}</p>
                    {wikiHref && <p className="mt-5"><a href={wikiHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-[color:var(--bc-white)] underline decoration-white/30 underline-offset-4 hover:decoration-[color:var(--bc-red)]">Read the full article on Wikipedia<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden>↗</span></a></p>}
                  </>
                ) : (
                  <p className="mt-6 text-[color:var(--bc-silver)]">No biography is available for {d.fullName} yet.</p>
                )}
              </>
            );
            return bioPhoto ? (
              <div className="grid items-start gap-x-12 gap-y-10 md:grid-cols-12">
                <div className="md:col-span-4">
                  <div className="dr-frame mx-auto max-w-[22rem]">
                    <Media src={bioPhoto.src} alt={d.fullName} kind="portrait" sizes="(max-width: 768px) 90vw, 32vw" />
                  </div>
                </div>
                <div className="md:col-span-8">
                  {story}
                  <div className="mt-10">{factSheet}</div>
                </div>
              </div>
            ) : (
              <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
                <div className="lg:col-span-7">{story}</div>
                <div className="lg:col-span-5 lg:pt-20">{factSheet}</div>
              </div>
            );
          })()}
        </div>
      </section>
    </CarbonPage>
  );
}
