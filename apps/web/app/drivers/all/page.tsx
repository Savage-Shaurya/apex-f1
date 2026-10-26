import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { PeopleUnavailable } from '@/components/drivers/PeopleUnavailable';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { jolpica } from '@apex/api-client/jolpica';
import { scalarPublicQuery } from '@/lib/public-query';
import { loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { getSeasonContext } from '@/lib/season';
import { Directory, type DirectoryItem } from '@/components/drivers/Directory';
import { indexLetter, searchKey } from '@/components/drivers/people';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';
import { CarbonPage, DisplayTitle, Kicker } from '@/components/drivers/carbon/primitives';
import { PressLink } from '@/components/brand-c/Press';

export const revalidate = 86400;
/** The full directory is several paced 100-row pages (about 9 for drivers); validated pages are cached for a day. */
const DIRECTORY_READ = { deadlineMs: 60_000, timeoutMs: 10_000 } as const;

export const metadata: Metadata = withSocial({
  title: 'Every Formula 1 driver since 1950',
  description: 'Search every driver in the Formula 1 world championship record since 1950 by name or nationality, each with a race-by-race career.',
  alternates: { canonical: '/drivers/all' },
});

export default async function DriverDirectoryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q: rawQuery } = await searchParams;
  const q = scalarPublicQuery(rawQuery) ?? '';
  const [read, seasons] = await Promise.all([
    readPublicSport(() => jolpica.getAllDrivers({ ...SPORT_READ_OPTIONS, ...DIRECTORY_READ, revalidate: 86400 })),
    getSeasonContext(),
  ]);
  if (read.state === 'unavailable') {
    await outageConnection();
    return <PeopleUnavailable title="Driver directory unavailable" reason="The driver directory can't be shown right now. Please check back in a few minutes." backHref="/drivers" backLabel="Current grid" />;
  }
  // World titles beside a name (committed archive plus the cached live merge). If the archive
  // is unavailable the directory simply shows no honours; it never guesses one.
  const archive = await loadDriverChampionshipArchive(seasons.lastCompletedSeason);
  const titles = new Map<string, number>();
  for (const row of archive.records) titles.set(row.winner.Driver.driverId, (titles.get(row.winner.Driver.driverId) ?? 0) + 1);

  const items: DirectoryItem[] = read.data
    .map((r) => {
      const t = titles.get(r.driverId) ?? 0;
      return {
        slug: r.driverId,
        href: `/drivers/${r.driverId}`,
        name: `${r.givenName} ${r.familyName}`.trim(),
        sortName: `${searchKey(r.familyName)} ${searchKey(r.givenName)}`,
        letter: indexLetter(r.familyName),
        nationality: r.nationality ?? null,
        badge: t ? (t === 1 ? 'World champion' : `${t} world titles`) : null,
      };
    })
    .sort((a, b) => a.sortName.localeCompare(b.sortName));
  const champions = items.filter((i) => i.badge).length;
  const nations = new Set(items.map((i) => i.nationality).filter(Boolean)).size;

  return (
    <CarbonPage>
      <section aria-labelledby="all-title" className="relative isolate overflow-hidden border-b border-[color:var(--bc-rule)]">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
        <div className="ds-container grid items-end gap-x-10 gap-y-8 pb-12 pt-10 md:pb-14 md:pt-14 lg:grid-cols-12 lg:pt-16">
          <div className="lg:col-span-7">
            <Kicker className="bc-in-up">Drivers · the archive</Kicker>
            <DisplayTitle id="all-title" text="Every driver" className="mt-5" />
            <p className="bc-in-up mt-5 max-w-[52ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]" style={{ '--d': '240ms' } as CSSProperties}>
              Everyone who has started a world championship Grand Prix since 1950, filed by surname. Open any name for a race-by-race career.
            </p>
            <div className="bc-in-up mt-7 flex flex-wrap gap-3" style={{ '--d': '360ms' } as CSSProperties}>
              <PressLink href="/drivers" variant="ghost">The current grid</PressLink>
              <PressLink href="/drivers/champions" variant="ghost">World champions</PressLink>
            </div>
          </div>
          <dl className="bc-in-up grid grid-cols-3 gap-x-6 border-t border-white/10 pt-5 lg:col-span-5" style={{ '--d': '300ms' } as CSSProperties}>
            <div><dt className="bc-label text-[color:var(--bc-titanium)]">Drivers</dt><dd className="bc-mono mt-2 text-[clamp(1.6rem,3vw,2.4rem)] leading-none">{items.length}</dd></div>
            <div><dt className="bc-label text-[color:var(--bc-titanium)]">Nations</dt><dd className="bc-mono mt-2 text-[clamp(1.6rem,3vw,2.4rem)] leading-none">{nations}</dd></div>
            <div><dt className="bc-label text-[color:var(--bc-titanium)]">Champions</dt><dd className="bc-mono mt-2 text-[clamp(1.6rem,3vw,2.4rem)] leading-none">{archive.state === 'unavailable' ? '–' : champions}</dd></div>
          </dl>
        </div>
      </section>
      <section aria-label="Driver directory" className="ds-container pb-24 pt-10 md:pt-12">
        {items.length === 0 ? (
          <p className="text-[color:var(--bc-silver)]">No drivers to show right now. Please check back in a few minutes.</p>
        ) : (
          <Directory key={q} items={items} initialQuery={q} noun="driver" nounPlural="drivers" />
        )}
      </section>
    </CarbonPage>
  );
}
