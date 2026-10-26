import type { Metadata } from 'next';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';
import { officialBetter, teamRecordNotes } from '@/lib/provider-notes';
import { notFound } from 'next/navigation';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { loadConstructor } from '@/components/data/load-constructor';
import { currentTeamParams } from '@/components/teams/data/static-params';
import { loadConstructorChampionshipArchive } from '@/components/data/load-championship-archive';
import { mapConstructor } from '@apex/api-client/jolpica';
import { getSeasonContext } from '@/lib/season';
import { constructorTitlesFromArchive } from '@/lib/constructor-titles';
import { teamColorBySlug } from '@/lib/format';
import '@/components/brand-c/brand-c.css';
import '@/components/teams/carbon/teams.css';
import { PressLink } from '@/components/brand-c/Press';
import { TeamHero } from '@/components/teams/TeamHero';
import { Kicker, Readout, Runs } from '@/components/teams/carbon/parts';
import { HistoryTimeline } from '@/components/teams/carbon/HistoryTimeline';
import { PositionChart } from '@/components/teams/PositionChart';
import { championshipHistory, historySummary } from '@/components/teams/championship-history';
import { loadConstructorStandingsArchive } from '@/components/teams/data/standings-archive';
import { getPeopleColours } from '@/components/drivers/data/people-data';
import { cleanName, ordinal, yearRuns } from '@/components/drivers/people';

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
  if (record.state === 'unavailable') return withSocial({ title: 'Team history', description: 'Formula 1 constructor history, temporarily unavailable.', robots: { index: false, follow: true } });
  if (record.state === 'missing') return withSocial({ title: 'Team not found', robots: { index: false, follow: true } });
  const c = mapConstructor(record.raw);
  const name = cleanName(c.name);
  return withSocial({
    title: `${name}: Formula 1 championship history`,
    description: `${name} in every Formula 1 Constructors' Championship since 1958: position, points and wins season by season.`,
    alternates: { canonical: `/teams/${c.slug}/history` },
  });
}

export default async function TeamHistoryPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const record = await loadConstructor(slug);
  if (record.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Team history unavailable" reason="This team's history can't be shown right now. Please check back in a few minutes." backHref="/teams" backLabel="All teams" />;
  }
  if (record.state === 'missing') notFound();
  const c = mapConstructor(record.raw);
  const name = cleanName(c.name);
  const ctx = await getSeasonContext();
  const [colours, standings, archive] = await Promise.all([
    getPeopleColours(),
    loadConstructorStandingsArchive(ctx.resultsSeason, ctx.lastCompletedSeason),
    loadConstructorChampionshipArchive(ctx.lastCompletedSeason),
  ]);
  const neutral = teamColorBySlug(null);
  const colour = teamColorBySlug(c.slug, colours);
  const color = colour === neutral ? null : colour;
  if (standings.missing.length) await outageConnection();
  const rows = championshipHistory(c.slug, standings.tables);
  const summary = historySummary(rows);
  const titleRead = constructorTitlesFromArchive(c.slug, archive);
  const titles = titleRead.state === 'confirmed' ? titleRead.record : null;
  const titleYears = new Set(titles?.years ?? []);
  const allMissing = standings.tables.length === 0 && standings.missing.length > 0;
  // Known provider errors in this team's seasons, shown beside the provider's numbers (R3-DATA-4).
  const sourceNotes = teamRecordNotes(c.slug, rows.map((r) => r.year));
  const notedYears = new Set(sourceNotes.map((n) => n.season));
  const span = summary.first !== null ? (summary.first === summary.last ? String(summary.first) : `${summary.first}–${summary.last}`) : null;

  return (
    <div className="bc relative">
      <TeamHero
        compact
        slug={c.slug}
        tab="history"
        name={name}
        color={color}
        logo={null}
        car={null}
        carAlt=""
        crumbs={[{ label: 'Teams', href: '/teams' }, { label: name, href: `/teams/${c.slug}` }, { label: 'History' }]}
        meta={[c.nationality, span ? `Championship seasons ${span}` : ''].filter(Boolean)}
        stats={rows.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <Readout label="Seasons" value={summary.seasons} note={span ?? undefined} />
            <Readout label="Titles" value={titles ? titles.titles : '–'} note={titles ? (titles.titles ? <><Runs text={yearRuns(titles.years)} /><span className="block text-[color:var(--bc-titanium)]">Through {titles.through}</span></> : `None through ${titles.through}`) : 'Unavailable right now'} />
            <Readout label="Best finish" value={summary.best !== null ? `P${summary.best}` : 'None'} note={officialBetter(sourceNotes, summary.best) ?? (summary.bestCount > 1 ? `${summary.bestCount} seasons` : undefined)} />
            <Readout label="Wins" value={summary.wins} note="In classified seasons" />
          </dl>
        ) : undefined}
      />

      {allMissing ? (
        <section className="ds-container border-t border-[color:var(--bc-rule)] py-16">
          <h2 className="bc-wide text-[1.6rem] text-white">Championship history unavailable</h2>
          <p className="mt-3 max-w-[60ch] text-[color:var(--bc-silver)]">The championship history can&apos;t be shown right now. Please check back in a few minutes.</p>
          <div className="mt-6"><PressLink href={`/teams/${c.slug}`} variant="ghost">Back to {name}</PressLink></div>
        </section>
      ) : rows.length === 0 ? (
        <section className="ds-container border-t border-[color:var(--bc-rule)] py-16">
          <h2 className="bc-wide text-[1.6rem] text-white">Not classified in a Constructors&apos; Championship</h2>
          <p className="mt-3 max-w-[60ch] text-[color:var(--bc-silver)]">
            {name} has no entry in any Constructors&apos; Championship table from {standings.from} to {standings.through}. The championship for constructors was first awarded in {standings.from}; teams that raced only before it, or never scored a classified place, have no season rows here.
          </p>
          {standings.missing.length > 0 && <p className="mt-3 text-[0.85rem] text-[color:var(--bc-titanium)]">Some seasons can&apos;t be shown right now: {yearRuns(standings.missing)}.</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <PressLink href={`/teams/${c.slug}`} variant="ghost">{name} profile</PressLink>
            <PressLink href="/teams/all" variant="ghost">Every constructor</PressLink>
          </div>
        </section>
      ) : (
        <>
          <section aria-labelledby="chart-title" className="border-t border-[color:var(--bc-rule)] py-16 lg:py-20">
            <div className="ds-container">
              <Kicker>At a glance</Kicker>
              <h2 id="chart-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">Every championship</h2>
              <p className="mt-3 max-w-[60ch] text-[1rem] text-[color:var(--bc-silver)]">
                {name}&apos;s place in the Constructors&apos; Championship, {span}.
                {summary.podiumSeasons > 0 ? ` Top three in ${summary.podiumSeasons} ${summary.podiumSeasons === 1 ? 'season' : 'seasons'}${summary.best === 1 ? `, champions ${summary.bestCount} ${summary.bestCount === 1 ? 'time' : 'times'}` : ''}.` : ''}
              </p>
              <div className="mt-10">
                <PositionChart rows={rows} name={name} />
              </div>
            </div>
          </section>
          <section aria-labelledby="timeline-title" className="border-t border-[color:var(--bc-rule)] pb-20 pt-16 lg:pt-20">
            <div className="ds-container">
              <Kicker>Timeline</Kicker>
              <h2 id="timeline-title" className="bc-display mt-4 text-[clamp(1.5rem,7.4vw,3.8rem)] text-white">Season by season</h2>
              <p className="mt-3 max-w-[60ch] text-[1rem] text-[color:var(--bc-silver)]">Newest first. Points are as scored under each season&apos;s rules (a win was worth 8 in 1958 and 25 since 2010), so compare within an era.</p>
              <div className="mt-10">
                <HistoryTimeline rows={rows} titleYears={titleYears} notedYears={notedYears} name={name} color={color} liveSeason={ctx.resultsSeason} lastCompleted={ctx.lastCompletedSeason} />
              </div>
              <div className="mt-8 flex flex-col gap-2 text-[0.85rem] text-[color:var(--bc-titanium)]">
                {sourceNotes.map((n) => <p key={n.season} role="note" className="text-[color:var(--bc-silver)]">Note: {n.line}</p>)}
                {standings.missing.length > 0 && <p>Some seasons can&apos;t be shown right now: {yearRuns(standings.missing)}.</p>}
                {rows.some((r) => r.entrants.length) && <p>Some seasons list the team under an engine-named entrant (for example Lotus-Climax); those rows are folded in and named after &ldquo;as&rdquo;.</p>}
                <p>The Constructors&apos; Championship began in {standings.from}. {summary.best !== null ? `${name}'s best finish is ${ordinal(summary.best)}.` : ''}</p>
              </div>
              <div className="mt-8"><PressLink href={`/teams/${c.slug}`} variant="ghost">Back to {name}</PressLink></div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
