import type { Metadata } from 'next';
import { Suspense } from 'react';
import { mapConstructorStanding, mapDriverStanding, mapRace } from '@apex/api-client/jolpica';
import '@/components/brand-c/brand-c.css';
import { CarbonNotice, Masthead } from '@/components/news/carbon';
import { miniCircuit } from '@/components/search/search-glyph';
import { getTeamColours } from '@/lib/grid';
import { readSearchCorpus, type SearchSource } from '@/lib/public-sport';
import { liveSearchSuggestions } from '@/lib/search-suggestions';
import type { TeamColours } from '@/lib/team-colours';
import { SearchClient, SearchClientFallback } from './search-client';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

export const revalidate = 1800;

// Static ISR page (audit 2026-11-01 VI-01): the query lives in the address bar and is read by the
// client, so every visit is served from cache instead of a 4 s per-request render. A query URL is kept
// out of the index by an `X-Robots-Tag: noindex` header (next.config.ts, audit SEO-4) and canonicalises to /search.
export const metadata: Metadata = withSocial({
  title: 'Search Formula 1 history',
  description: 'Search every Formula 1 driver since 1950, every constructor, every season and this year’s races.',
  alternates: { canonical: '/search' },
});

/** What each missing source takes out of the search, in plain words. */
const MISSING_LABEL: Record<SearchSource, string> = {
  driverStandings: 'this season’s drivers',
  constructorStandings: 'this season’s teams',
  schedule: 'this season’s races',
  allDrivers: 'former drivers',
  seasons: 'season years',
  allConstructors: 'former constructors',
};

export type SearchItem = {
  kind: 'driver' | 'team' | 'race';
  slug: string;
  title: string;
  meta: string;
  href: string;
  /** On the current season's grid or calendar; ranks ahead of history on ties. */
  current?: boolean;
  /** Team colour from the live timing feed (current drivers and teams only). */
  accent?: string;
  /** Three-letter timing code (current drivers), shown when no team colour is known. */
  code?: string;
  /** Real circuit outline for this season's races. */
  circuit?: { d: string; viewBox: string };
};

/**
 * Team colours come from OpenF1 via lib/grid. They decorate rows, so they get
 * a short budget: when timing is slow or down the rows simply carry no stripe.
 */
async function teamColours(): Promise<TeamColours> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getTeamColours(),
      new Promise<TeamColours>((resolve) => { timer = setTimeout(() => resolve({}), 4000); }),
    ]);
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default async function SearchPage() {
  const [corpus, colours] = await Promise.all([readSearchCorpus(), teamColours()]);
  if (corpus.state === 'unavailable') {
    await outageConnection();
    return (
      <div className="bc tone-carbon relative" data-page="search">
        <Masthead kicker="Search" title="Search" />
        <div className="ds-container pb-24">
          <CarbonNotice tone="unavailable" title="Search unavailable" action={{ label: 'Browse the driver grid', href: '/drivers' }}>
            Search can’t be used right now. Please check back in a few minutes, or browse the drivers instead.
          </CarbonNotice>
        </div>
      </div>
    );
  }
  // Some sources are down: search what did load, say what is missing, and keep this render for a minute only.
  if (corpus.state === 'partial') await outageConnection();
  const { data, missing } = corpus;
  const drivers = (data.driverStandings ?? []).map(mapDriverStanding);
  const constructors = (data.constructorStandings ?? []).map(mapConstructorStanding);
  const races = (data.schedule ?? []).map(mapRace);
  const allDrivers = data.allDrivers ?? [];
  const allConstructors = data.allConstructors ?? [];
  const seasons = data.seasons ?? [];
  const currentDrivers = new Set(drivers.map((d) => d.driver.slug));
  const currentTeams = new Set(constructors.map((t) => t.constructor.slug));
  const season = races[0]?.season ?? null;
  const missingText = missing.map((m) => MISSING_LABEL[m]).join(', ');

  const items: SearchItem[] = [
    ...drivers.map((d): SearchItem => ({
      kind: 'driver',
      slug: d.driver.slug,
      title: d.driver.fullName,
      meta: [d.driver.code, d.constructorName, d.position === null ? 'Unranked' : `P${d.position}`, `${d.points} pts`].filter(Boolean).join(' · '),
      href: `/drivers/${d.driver.slug}`,
      current: true,
      accent: colours[d.constructorSlug],
      code: d.driver.code || undefined,
    })),
    // Every other driver since 1950, so "Senna", "Prost" and "Fangio" resolve.
    ...allDrivers
      .filter((d) => !currentDrivers.has(d.driverId))
      .map((d): SearchItem => ({
        kind: 'driver',
        slug: d.driverId,
        title: `${d.givenName} ${d.familyName}`,
        meta: [d.nationality, 'Former F1 driver'].filter(Boolean).join(' · '),
        href: `/drivers/${d.driverId}`,
      })),
    ...constructors.map((c): SearchItem => ({
      kind: 'team',
      slug: c.constructor.slug,
      title: c.constructor.name,
      meta: [c.constructor.nationality, c.position === null ? 'Unranked' : `P${c.position}`, `${c.points} pts`].filter(Boolean).join(' · '),
      href: `/teams/${c.constructor.slug}`,
      current: true,
      accent: colours[c.constructor.slug],
    })),
    ...allConstructors
      .filter((t) => !currentTeams.has(t.constructorId))
      .map((t): SearchItem => ({ kind: 'team', slug: t.constructorId, title: t.name, meta: [t.nationality, 'Historical constructor'].filter(Boolean).join(' · '), href: `/teams/${t.constructorId}` })),
    ...races.map((r): SearchItem => ({
      kind: 'race',
      slug: r.routeSlug ?? r.slug,
      title: r.name,
      meta: `Round ${r.round} · ${r.circuitName} · ${r.city}, ${r.country}`,
      href: `/schedule/${r.season}/${r.routeSlug ?? r.slug}`,
      current: true,
      circuit: miniCircuit(r.circuitId) ?? undefined,
    })),
    // Every season year, so "1988" opens that season's standings.
    ...seasons.map((s): SearchItem => ({ kind: 'race', slug: `season-${s.season}`, title: `${s.season} season`, meta: 'Standings and results', href: `/results/${s.season}/drivers` })),
  ];

  const suggestions = liveSearchSuggestions({ leaderSurname: drivers[0]?.driver.lastName, leadingTeam: constructors[0]?.constructor.name, races, seasons });
  const clientProps = { items, suggestions, season, incomplete: missing.length > 0 };

  return (
    <div className="bc tone-carbon relative" data-page="search">
      <Masthead kicker={<>{data.allDrivers ? 'Every driver since 1950 · ' : ''}{items.length.toLocaleString('en-GB')} records</>} title="Search">
        <p className="max-w-[42ch] text-[clamp(1.02rem,0.95rem+0.3vw,1.18rem)] leading-relaxed text-[color:var(--bc-silver)]">
          {data.allDrivers ? 'Every Formula 1 driver since 1950' : 'Formula 1 drivers'}{data.allConstructors ? ', every constructor' : ''}{data.seasons ? ', every season' : ''}{season ? `, and the ${season} races` : ''}. Share any search by its link.
        </p>
      </Masthead>
      <div className="ds-container pb-[clamp(4rem,8vw,7rem)]">
        {missing.length > 0 && (
          <p role="status" className="mb-8 max-w-[70ch] rounded-2xl px-5 py-4 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)] ring-1 ring-white/10">
            <span className="font-semibold text-[color:var(--bc-white)]">Some records can’t be searched right now:</span> {missingText}. Everything else below is searchable, and the rest returns here on its own.
          </p>
        )}
        {/* The query is read from the address bar on the client; the fallback is the same search, unfiltered. */}
        <Suspense fallback={<SearchClientFallback {...clientProps} />}>
          <SearchClient {...clientProps} />
        </Suspense>
      </div>
    </div>
  );
}
