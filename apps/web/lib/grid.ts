import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { isRankedStanding, jolpica, mapConstructorStanding, mapDriverStanding, type UiConstructorStanding, type UiDriverStanding } from '@apex/api-client/jolpica';

/** The live grid and home tables show ranked rows only; full tables (with unranked rows) live on /results/{season}. */
type RankedDriverStanding = UiDriverStanding & { position: number };
type RankedConstructorStanding = UiConstructorStanding & { position: number };
import { getWikipediaSummaryByUrl } from '@apex/api-client/wikipedia';
import { commonsFileName } from '@apex/api-client/wikimedia';
import { commonsDisplayUrl } from './commons-image';
import { teamColorBySlug } from './format';
import { teamColoursFromTiming, normaliseTeamColour, type TeamColours } from './team-colours';
import { readCalendar, readCurrentStandings, type PublicCalendar } from './public-sport';
import { createPageOpenF1Reader } from './openf1-shared-reader';
import { probeRealHeadshotStrict } from './headshot-probe';
import { getDriverMedia } from './f1-media';
import { loadGridTiming, lookupGridTimingEntry, type GridTimingSnapshot } from './grid-timing';
import { outageConnection } from '@/lib/outage-connection';

/**
 * Shared season data joins, built to run unattended across seasons.
 *
 *  - Standings come from Jolpica "current". Between seasons (a new year
 *    with no classified race yet) they fall back to the previous season's
 *    final table, labelled as such, instead of rendering empty.
 *  - The calendar rolls forward on its own: once the current season has no
 *    race left, the next season's published schedule becomes "next".
 *  - Portraits: the F1 media CDN's high-resolution cut-out for the
 *    standings season (HEAD-validated; rookies included), else OpenF1's
 *    headshot_url when it is a real photo (F1's grey silhouette placeholder
 *    is detected and skipped; timing rows only join the standings' season and
 *    verified session), else a scaled Wikimedia Commons portrait.
 *
 * Every consumer awaits the same per-request cached promise.
 */

export interface GridDriver {
  slug: string;
  code: string;
  number: number | null;
  firstName: string;
  lastName: string;
  /** The team of the driver's latest race entry this season. */
  team: string;
  teamSlug: string;
  /** Every team the driver raced for this season, the current team last (R3-DATA-1). */
  teams: Array<{ slug: string; name: string }>;
  color: string;
  /** Transparent head-and-shoulders cut-out (render with fit="contain"). Null when unavailable. */
  headshot: string | null;
  /** Transparent full-body cut-out from the F1 media CDN (fit="contain"). Null when unavailable. */
  cutout: string | null;
  /** Rectangular photo fallback (render with fit="cover"). */
  portrait: string | null;
  position: number;
  points: number;
  wins: number;
}

/* ---------------------------------------------------------------- seasons */

export type SeasonCalendar = PublicCalendar;
const calendarRead = cache((): Promise<SeasonCalendar> => readCalendar());

/** Request-scoped: set by a route that prefers a prerendered unavailable state over a whole-deployment dynamic route when a provider fails during `next build`. */
const buildScope = cache(() => ({ tolerant: false }));
/**
 * Call at the top of a route (the home page). An outage normally opts the
 * request out of the ISR cache via connection(). During `next build` that
 * same call marks the route dynamic for the whole deployment, so one provider
 * hiccup while prerendering made `/` render on every visit (`private,
 * no-store`). In a tolerant route a build-time outage instead prerenders the
 * honest unavailable state, which the route's short revalidate window
 * replaces on the first visit after it; outages at runtime still opt out.
 */
export function tolerateBuildOutages() { buildScope().tolerant = true; }
/** An outage opts this request out of the ISR cache, so a failure is never served for the whole window. */
export async function optOutOnOutage() {
  if (process.env.NEXT_PHASE === 'phase-production-build' && buildScope().tolerant) return;
  // Request-time renders go dynamic; a runtime ISR regeneration serves the honest state for its short window (lib/outage-connection).
  await outageConnection();
}
/** Page reads: an outage opts the request out of the ISR cache so it is never served for the whole window. */
export const getCalendar = cache(async (): Promise<SeasonCalendar> => {
  const calendar = await calendarRead();
  if (calendar.state === 'unavailable') await optOutOnOutage();
  return calendar;
});
/**
 * Shell reads (root layout: nav, footer). Same request-cached data, but an
 * outage never calls connection(): the layout wraps every route, so doing so
 * made the whole site render per request. Shell components show their own
 * honest empty state; the page's own reads still decide its caching.
 */
export const getShellCalendar = calendarRead;

/* -------------------------------------------------------------- standings */

export interface StandingsSeason {
  state: 'available' | 'unavailable';
  season: number | null;
  /** True when "current" had no classified round yet and the table shown is the previous season's final one. */
  previousSeasonFinal: boolean;
  /** Last classified round in that table; null when none is published. */
  round: number | null;
}

const driverTableRead = cache(async (): Promise<{ rows: RankedDriverStanding[] } & StandingsSeason> => {
  const read = await readCurrentStandings(jolpica.getDriverStandingsSnapshot);
  return { state: read.state, rows: read.snapshot?.standings.map(mapDriverStanding).filter(isRankedStanding) ?? [], season: read.snapshot?.season ? Number(read.snapshot.season) : null, round: read.snapshot?.round ?? null, previousSeasonFinal: read.previousSeasonFinal };
});
const driverTable = cache(async (): Promise<{ rows: RankedDriverStanding[] } & StandingsSeason> => {
  const table = await driverTableRead();
  if (table.state === 'unavailable') await optOutOnOutage();
  return table;
});

const constructorTable = cache(async (): Promise<{ rows: RankedConstructorStanding[] } & StandingsSeason> => {
  const read = await readCurrentStandings(jolpica.getConstructorStandingsSnapshot);
  if (read.state === 'unavailable') await optOutOnOutage();
  return { state: read.state, rows: read.snapshot?.standings.map(mapConstructorStanding).filter(isRankedStanding) ?? [], season: read.snapshot?.season ? Number(read.snapshot.season) : null, round: read.snapshot?.round ?? null, previousSeasonFinal: read.previousSeasonFinal };
});

export const getDriverStandings = cache(async (): Promise<RankedDriverStanding[]> => (await driverTable()).rows);
export const getConstructorStandings = cache(async (): Promise<RankedConstructorStanding[]> => (await constructorTable()).rows);

/** Constructor snapshots can independently fall back to a different season. */
export const getConstructorStandingsSeason = cache(async (): Promise<StandingsSeason> => {
  const table = await constructorTable();
  return { state: table.state, season: table.season, round: table.round, previousSeasonFinal: table.previousSeasonFinal };
});

/** Which season the standings tables actually describe. */
export const getStandingsSeason = cache(async (): Promise<StandingsSeason> => {
  const t = await driverTable();
  return { state: t.state, season: t.season, round: t.round, previousSeasonFinal: t.previousSeasonFinal };
});

/** Shell variant of getStandingsSeason: never opts the route out of ISR (see getShellCalendar). */
export const getShellStandingsSeason = cache(async (): Promise<StandingsSeason> => {
  const t = await driverTableRead();
  return { state: t.state, season: t.season, round: t.round, previousSeasonFinal: t.previousSeasonFinal };
});

/* -------------------------------------------------------------- portraits */

// Timing and reserve-driver reads share one bounded reader for the page request.
const pageTimingReader = cache(() => createPageOpenF1Reader());
const getTimingDrivers = cache(async (season: number | null): Promise<GridTimingSnapshot> =>
  loadGridTiming(pageTimingReader(), season),
);

/** Acronym results are admitted only for the already verified session. */
const recentTimingEntry = cache((timing: GridTimingSnapshot, acronym: string) =>
  lookupGridTimingEntry(timing, acronym, pageTimingReader()),
);

/**
 * F1's image CDN answers a missing driver photo with a ~2KB grey
 * silhouette under HTTP 200. Probe a trusted CDN's small rendition and
 * use its size as a conservative placeholder heuristic. Unknown images
 * remain unavailable and use the portrait fallback. Cached for a day.
 */
const cachedRealHeadshot = unstable_cache(
  (url: string) => probeRealHeadshotStrict(url),
  ['apex-headshot-real-v3'],
  { revalidate: 86400 },
);
// An inconclusive probe is not cached as "no photo"; it reads as none for this render only.
const getRealHeadshot = (url: string) => cachedRealHeadshot(url).catch(() => null);

const wikiPortrait = unstable_cache(
  async (wikiUrl: string): Promise<string | null> => {
    try {
      const s = await getWikipediaSummaryByUrl(wikiUrl, { revalidate: 86400 });
      // A bucketed Commons thumbnail, never the multi-megabyte original.
      const file = commonsFileName(s?.originalImageUrl) ?? commonsFileName(s?.thumbnailUrl);
      return file ? commonsDisplayUrl(file, 960) : null;
    } catch {
      return null;
    }
  },
  ['apex-wiki-portrait-v3'],
  { revalidate: 86400 },
);

/**
 * Live constructorId -> team colour map (OpenF1 `team_colour`) for the
 * standings season. Uses the same verified timing session as the grid;
 * empty when timing is unavailable, so callers fall back to neutral.
 */
export const getTeamColours = cache(async (): Promise<TeamColours> => {
  const table = await driverTable();
  const timing = await getTimingDrivers(table.season);
  const rows = table.rows.map((s) => ({ constructorSlug: s.constructorSlug, code: s.driver.code }));
  const known = new Set(timing.drivers.map((d) => d.name_acronym));
  // Drivers missing from the session roster may still have a row for the same session.
  const extra = await Promise.all(table.rows
    .filter((s) => s.driver.code && !known.has(s.driver.code))
    .map((s) => recentTimingEntry(timing, s.driver.code)));
  return teamColoursFromTiming(rows, [...timing.drivers, ...extra.filter((d): d is NonNullable<typeof d> => d !== null)]);
});

export const getGrid = cache(async (): Promise<GridDriver[]> => {
  const table = await driverTable();
  const timing = await getTimingDrivers(table.season);
  const byCode = new Map(timing.drivers.map((d) => [d.name_acronym, d]));
  // Team-mates share a colour, so a driver missing from the feed takes their team's.
  const colours = await getTeamColours();

  return Promise.all(
    table.rows.map(async (s): Promise<GridDriver> => {
      const t = byCode.get(s.driver.code) ?? (await recentTimingEntry(timing, s.driver.code));
      const candidate = t?.headshot_url ?? null;
      const media = await getDriverMedia({
        season: table.season,
        constructorId: s.constructorSlug,
        openF1TeamName: t?.team_name ?? null,
        openF1HeadshotUrl: candidate,
        firstName: s.driver.firstName,
        lastName: s.driver.lastName,
      });
      const headshot = media?.headshot ?? (candidate ? await getRealHeadshot(candidate) : null);
      const portrait = headshot || !s.driver.wikiUrl ? null : await wikiPortrait(s.driver.wikiUrl);
      return {
        slug: s.driver.slug,
        code: s.driver.code,
        number: s.driver.number ?? t?.driver_number ?? null,
        firstName: s.driver.firstName,
        lastName: s.driver.lastName,
        team: s.constructorName,
        teamSlug: s.constructorSlug,
        teams: s.constructors.length ? s.constructors : s.constructorSlug ? [{ slug: s.constructorSlug, name: s.constructorName }] : [],
        color: normaliseTeamColour(t?.team_colour) ?? teamColorBySlug(s.constructorSlug, colours),
        headshot,
        cutout: media?.cutout ?? null,
        portrait,
        position: s.position,
        points: s.points,
        wins: s.wins,
      };
    }),
  );
});
