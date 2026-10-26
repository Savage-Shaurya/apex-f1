import type { Metadata } from 'next';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';
import '@/components/brand-c/brand-c.css';
import '@/components/teams/carbon/teams.css';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { jolpica } from '@apex/api-client/jolpica';
import { scalarPublicQuery } from '@/lib/public-query';
import { getConstructorStandings, getConstructorStandingsSeason } from '@/lib/grid';
import { getSeasonContext } from '@/lib/season';
import { teamColorBySlug } from '@/lib/format';
import { loadConstructorChampionshipArchive } from '@/components/data/load-championship-archive';
import { constructorTitlesFromArchive } from '@/lib/constructor-titles';
import { getPeopleColours } from '@/components/drivers/data/people-data';
import { cleanName, indexLetter, searchKey } from '@/components/drivers/people';
import { PressLink } from '@/components/brand-c/Press';
import { fitDisplay, Kicker } from '@/components/teams/carbon/parts';
import { TeamDirectory, type TeamDirectoryItem } from '@/components/teams/directory/TeamDirectory';

export const revalidate = 86400;
const DIRECTORY_READ = { deadlineMs: 60_000, timeoutMs: 10_000 } as const;

export const metadata: Metadata = withSocial({
  title: 'Every Formula 1 constructor since 1950',
  description: 'Search every constructor in the Formula 1 world championship record since 1950 by name or nationality, with the current grid and every champion marked.',
  alternates: { canonical: '/teams/all' },
});

export default async function ConstructorDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q: rawQuery } = await searchParams;
  const q = scalarPublicQuery(rawQuery) ?? '';
  const ctx = await getSeasonContext();
  const [read, standings, table, colours, archive] = await Promise.all([
    readPublicSport(() => jolpica.getAllConstructors({ ...SPORT_READ_OPTIONS, ...DIRECTORY_READ, revalidate: 86400 })),
    getConstructorStandings(),
    getConstructorStandingsSeason(),
    getPeopleColours(),
    loadConstructorChampionshipArchive(ctx.lastCompletedSeason),
  ]);
  if (read.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Constructor directory unavailable" reason="The constructor directory can't be shown right now. Please check back in a few minutes." backHref="/teams" backLabel="Current teams" />;
  }
  const onGrid = new Set(standings.map((s) => s.constructor.slug));
  const titlesKnown = archive.state === 'complete';
  const items: TeamDirectoryItem[] = read.data
    .map((r) => {
      const name = cleanName(r.name);
      const titles = titlesKnown ? constructorTitlesFromArchive(r.constructorId, archive) : null;
      return {
        slug: r.constructorId,
        href: `/teams/${r.constructorId}`,
        name,
        sortName: searchKey(name),
        letter: indexLetter(name.split(/\s+/)[0] ?? name),
        nationality: r.nationality ?? null,
        color: onGrid.has(r.constructorId) ? teamColorBySlug(r.constructorId, colours) : null,
        titles: titles?.state === 'confirmed' ? titles.record.titles : 0,
      };
    })
    .sort((a, b) => a.sortName.localeCompare(b.sortName));

  return (
    <div className="bc relative">
      <section aria-labelledby="dir-title" className="relative isolate overflow-hidden border-b border-[color:var(--bc-rule)]">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
        <div className="ds-container pb-10 pt-10 md:pb-14 md:pt-16">
          <Kicker>The record · 1950 to {table.season ?? ctx.resultsSeason}</Kicker>
          <div className="[container-type:inline-size]">
            <h1 id="dir-title" className="bc-display mt-5 text-[color:var(--bc-white)]" style={{ fontSize: fitDisplay('Every constructor', 'clamp(2.4rem, 6.2vw, 5.4rem)') }}>Every constructor</h1>
          </div>
          <p className="mt-5 max-w-[56ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">
            <span className="bc-mono text-[color:var(--bc-white)]">{items.length}</span> constructors have entered a world championship Grand Prix since 1950. Engine-named entries such as Lotus-Climax are listed on their own, as they were entered.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <PressLink href="/teams" variant="solid">The {table.season ?? 'current'} teams <span aria-hidden>→</span></PressLink>
            <PressLink href="/teams/champions" variant="ghost">Constructor champions</PressLink>
          </div>
        </div>
      </section>
      <div className="ds-container pb-24 pt-10 md:pt-14">
        {items.length === 0 ? (
          <p className="text-[color:var(--bc-silver)]">No constructors to show right now. Please check back in a few minutes.</p>
        ) : (
          <TeamDirectory key={q} items={items} season={table.season} titlesKnown={titlesKnown} />
        )}
      </div>
    </div>
  );
}
