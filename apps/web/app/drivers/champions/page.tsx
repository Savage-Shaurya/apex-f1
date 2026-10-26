import type { Metadata } from 'next';
import { mapDriverStanding } from '@apex/api-client/jolpica';
import { loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { getSeasonContext } from '@/lib/season';
import { getDriverMedia, getSeasonPortrait } from '@/lib/f1-media';
import { NEUTRAL_TEAM_COLOUR } from '@/lib/team-colours';
import type { CSSProperties } from 'react';
import type { HallEntry, HallLeader } from '@/components/drivers/hall/ChampionsHall';
import { DriverHall } from '@/components/drivers/hall/DriverHall';
import { CarbonPage, DisplayTitle, Kicker, LitPortrait } from '@/components/drivers/carbon/primitives';
import { PressLink } from '@/components/brand-c/Press';
import { championPortraits } from '@/components/drivers/data/champion-portraits';
import { getPeopleGrid } from '@/components/drivers/data/people-data';
import { cleanName, formatPoints } from '@/components/drivers/people';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

// The archive is a committed snapshot plus a cached live merge, so the page is
// regenerated hourly (PERF2-5); an incomplete merge calls connection() and renders per request.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { lastCompletedSeason } = await getSeasonContext();
  return withSocial({
    title: 'Formula 1 world champions',
    description: `Every Formula 1 World Drivers' Champion from 1950 to ${lastCompletedSeason}, with the drivers who won the most titles.`,
    alternates: { canonical: '/drivers/champions' },
  });
}

type Archive = Awaited<ReturnType<typeof loadDriverChampionshipArchive>>;

function rowsOf(archive: Archive) {
  return archive.records.map(({ year, winner }) => {
    const s = mapDriverStanding(winner);
    return {
      year,
      slug: s.driver.slug,
      first: s.driver.firstName,
      last: s.driver.lastName,
      name: s.driver.fullName,
      nationality: s.driver.nationality,
      wikiUrl: s.driver.wikiUrl || null,
      teamSlug: s.constructorSlug,
      teamName: cleanName(winner.Constructors.map((t) => t.name).join(' and ')),
      // Team colours are this season's liveries; a completed title season never wears them.
      color: NEUTRAL_TEAM_COLOUR,
      points: s.points,
      wins: s.wins,
    };
  });
}

async function Hall({ through }: { through: number }) {
  const archive = await loadDriverChampionshipArchive(through);
  if (archive.state !== 'complete') await outageConnection();
  const rows = rowsOf(archive);
  if (!rows.length) {
    return (
      <section className="ds-container border-t border-[color:var(--bc-rule)] py-16">
        <p className="bc-wide text-[1.3rem]">Champions unavailable</p>
        <p className="mt-2 max-w-[56ch] text-[color:var(--bc-silver)]">{archive.state === 'empty' ? 'No completed championship is on record yet.' : 'The champions can\'t be shown right now. They return here on their own.'}</p>
        <div className="mt-6"><PressLink href="/results/archive" variant="ghost">Open the results archive</PressLink></div>
      </section>
    );
  }
  const people = Array.from(new Map(rows.map((r) => [r.slug, { key: r.slug, wikiUrl: r.wikiUrl, name: r.name }])).values());
  const recent = rows.filter((r) => r.year >= 2024);
  // Before the 2024 cut-out masters, F1 media's archive has an official studio portrait for some title seasons.
  const archived = rows.filter((r) => r.year >= 2014 && r.year < 2024);
  const [portraits, cutouts, seasonPhotos] = await Promise.all([
    championPortraits(people),
    Promise.all(recent.map((r) => getDriverMedia({ season: r.year, constructorId: r.teamSlug, firstName: r.first, lastName: r.last }))),
    Promise.all(archived.map((r) => getSeasonPortrait(r.year, r.last))),
  ]);
  const cutoutByYear = new Map(recent.map((r, i) => [r.year, cutouts[i]?.cutout ?? null]));
  const seasonPhotoByYear = new Map(archived.map((r, i) => [r.year, seasonPhotos[i] ?? null]));

  const entries: HallEntry[] = rows.map((r) => {
    const cut = cutoutByYear.get(r.year);
    const season = seasonPhotoByYear.get(r.year);
    const portrait = portraits.get(r.slug);
    return {
      year: r.year,
      key: r.slug,
      name: r.name,
      href: `/drivers/${r.slug}`,
      resultsHref: `/results/${r.year}/drivers`,
      team: { name: r.teamName, color: r.color },
      nationality: r.nationality,
      points: r.points,
      wins: r.wins,
      picture: cut
        ? { kind: 'cutout', src: cut }
        : season
          // Formula 1 media is credited site-wide (footer) and in the source note below, like the cut-outs.
          ? { kind: 'photo', src: season, yearSpecific: true }
          : portrait ? { kind: 'photo', src: portrait.src } : null,
    };
  });
  const byDriver = new Map<string, HallLeader>();
  for (const r of rows) {
    const l = byDriver.get(r.slug) ?? { key: r.slug, name: r.name, href: `/drivers/${r.slug}`, years: [] };
    l.years.push(r.year);
    byDriver.set(r.slug, l);
  }
  const grid = await getPeopleGrid();
  const leaders = Array.from(byDriver.values())
    .sort((a, b) => b.years.length - a.years.length || a.years[0]! - b.years[0]!)
    .slice(0, 6)
    .map((l): HallLeader => {
      // On the plinth: today's F1 media cut-out for a champion still racing, else their credited Commons portrait.
      const onGrid = grid.find((g) => g.slug === l.key);
      const portrait = portraits.get(l.key);
      return {
        ...l,
        picture: onGrid?.cutout ? { kind: 'cutout', src: onGrid.cutout } : portrait ? { kind: 'photo', src: portrait.src } : null,
      };
    });

  return (
    <>
      {archive.missing.length > 0 && (
        <p className="ds-container pb-8 text-[0.95rem] text-[color:var(--bc-silver)]">
          The champions of {archive.missing.join(', ')} can&apos;t be shown right now, so the counts below are partial.
        </p>
      )}
      <DriverHall entries={entries} leaders={leaders} hallId="driver-hall" />
      <p className="ds-container py-10 text-[0.875rem] text-[color:var(--bc-titanium)]">The current season is never counted as a title.</p>
    </>
  );
}

async function Newest({ through }: { through: number }) {
  const archive = await loadDriverChampionshipArchive(through);
  const rows = rowsOf(archive);
  const last = rows.reduce<(typeof rows)[number] | null>((a, r) => (!a || r.year > a.year ? r : a), null);
  if (!last) return null;
  const media = last.year >= 2024 ? await getDriverMedia({ season: last.year, constructorId: last.teamSlug, firstName: last.first, lastName: last.last }) : null;
  const titles = rows.filter((r) => r.slug === last.slug).length;
  return (
    <figure className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-end gap-x-5 sm:gap-x-8">
      {media?.cutout ? (
        <LitPortrait src={media.cutout} name={last.name} alt={`${last.name}, ${last.year} world champion`} framing="bust" ratio="4 / 5" priority sizes="(max-width: 768px) 45vw, 260px" />
      ) : <span aria-hidden />}
      <figcaption className="min-w-0 pb-4" style={{ containerType: 'inline-size' }}>
        <p className="bc-label text-[color:var(--bc-titanium)]">Newest champion</p>
        {/* the year fits its column (never clipped, never wider than the caption) */}
        <p className="bc-mono mt-2 whitespace-nowrap leading-none text-[color:var(--bc-white)]" style={{ fontSize: 'min(4.5rem, 26cqi)' }}>{last.year}</p>
        <p className="bc-wide mt-3 text-[clamp(1.1rem,2vw,1.5rem)] leading-tight text-[color:var(--bc-white)] [overflow-wrap:anywhere]">{last.name}</p>
        <p className="mt-1 text-[0.95rem] text-[color:var(--bc-silver)]">{last.teamName}</p>
        <p className="bc-mono mt-2 text-[0.875rem] text-[color:var(--bc-silver)]">{last.wins} wins · {formatPoints(last.points)} pts{titles > 1 ? ` · title ${titles}` : ''}</p>
      </figcaption>
    </figure>
  );
}

export default async function ChampionsPage() {
  const { lastCompletedSeason: through, resultsSeason } = await getSeasonContext();
  return (
    <CarbonPage>
      <section aria-labelledby="champions-title" className="relative isolate overflow-hidden">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
        <div className="ds-container grid items-end gap-x-10 gap-y-10 pb-14 pt-10 md:pt-14 lg:grid-cols-12 lg:pt-16">
          <div className="min-w-0 lg:col-span-7">
            <Kicker className="bc-in-up">Drivers · the hall</Kicker>
            <DisplayTitle id="champions-title" text="World champions" className="mt-5" />
            <p className="bc-in-up mt-5 max-w-[46ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]" style={{ '--d': '240ms' } as CSSProperties}>
              Every World Drivers&apos; Champion since 1950, through {through}. The greatest on their plinths, then every title hung in its decade.
            </p>
            <div className="bc-in-up mt-7 flex flex-wrap gap-3" style={{ '--d': '360ms' } as CSSProperties}>
              <PressLink href={`/results/${resultsSeason}/drivers`} variant="solid">{resultsSeason} standings <span aria-hidden>→</span></PressLink>
              <PressLink href="/teams/champions" variant="ghost">Constructor champions</PressLink>
            </div>
          </div>
          <div className="bc-in-strike min-w-0 lg:col-span-5" style={{ '--d': '200ms' } as CSSProperties}>
            <Newest through={through} />
          </div>
        </div>
      </section>
      {/* Rendered in place, not streamed: the page's one scroll choreography must never touch
          markup that has not hydrated yet (a streamed boundary mismatched on hydration). */}
      <Hall through={through} />
    </CarbonPage>
  );
}
