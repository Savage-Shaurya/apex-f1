import { cache } from 'react';
import { jolpica, type UiRace, type UiResult } from '@apex/api-client/jolpica';
import { openf1, type OpenF1Driver, type OpenF1Session } from '@apex/api-client/openf1';
import { getCalendar, getConstructorStandings, getConstructorStandingsSeason, getDriverStandings, getGrid, getStandingsSeason, getTeamColours, type GridDriver } from '@/lib/grid';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { loadRaceResults } from '@/lib/race-detail';
import { getCircuitHeroImage, type CreditedImage } from '@/lib/commons-image';
import { circuitFactsKey, loadCircuitFacts, type CircuitFacts } from '@/lib/circuits/facts';
import { decodeEntities, teamColorBySlug } from '@/lib/format';
import { normaliseTeamColour, teamColoursFromTiming, type TeamColours } from '@/lib/team-colours';
import { raceReadTtlSeconds } from '@/lib/data-freshness';
import { lastRaceCandidates, latestFinishedSession, matchTimingSession, sessionFinished, sessionStartMs, titleFight, topThreeCodes, type TitleFight } from './weekend';
import { deferWrite } from '@/lib/defer-write';

/**
 * Page-level data wiring for the homepage. Every read goes through the
 * request-cached providers in lib/ (Jolpica via the shared limiter, the F1
 * media CDN probes, Wikimedia Commons); failures become explicit
 * `unavailable` states, never invented values.
 */

// FIA three-letter code when Jolpica publishes one; otherwise the surname in full (never an invented code).
const codeOf = (d: { code?: string; familyName: string }) => (d.code?.trim() || d.familyName).toUpperCase();

/** Classifications Jolpica has published for the race weekend (top codes per session). */
async function publishedPodiums(race: UiRace, now: number): Promise<Partial<Record<string, string[]>>> {
  const started = (kind: string) => {
    const s = race.sessions.find((x) => x.kind === kind);
    const start = s ? sessionStartMs(s.iso) : null;
    return start !== null && start <= now;
  };
  const opts = { ...SPORT_READ_OPTIONS, revalidate: Math.min(300, raceReadTtlSeconds(race, now)) };
  const [q, s, r] = await Promise.all([
    started('Q') ? readPublicSport(() => jolpica.getQualifying(race.season, race.round, opts)) : null,
    started('S') ? readPublicSport(() => jolpica.getSprint(race.season, race.round, opts)) : null,
    started('R') ? readPublicSport(() => jolpica.getRaceResults(race.season, race.round, opts)) : null,
  ]);
  const out: Partial<Record<string, string[]>> = {};
  const byPosition = <T extends { position: string; Driver: { code?: string; familyName: string } }>(rows: T[]) =>
    [...rows].sort((a, b) => Number(a.position) - Number(b.position)).map((row) => codeOf(row.Driver));
  if (q?.state === 'available' && q.data.length) out.Q = byPosition(q.data);
  if (s?.state === 'available' && s.data.length) out.S = byPosition(s.data);
  if (r?.state === 'available' && r.data?.results.length) out.R = byPosition(r.data.results);
  return out;
}

/* ------------------------------------------------- OpenF1 final timing */

// Free historical OpenF1 reads only: the season's session list, a finished
// session's roster and its final classification. Nothing is read while a
// session is running (no live timing), and every failure reads as "not
// published" rather than a guessed result.
const timingSessions = cache(async (season: number): Promise<OpenF1Session[] | null> => {
  try {
    // Last good copy while OpenF1 refuses free reads during a live session.
    return await openf1.getSessionsForYear(season, { strict: true, revalidate: 900, lastGood: 'fallback' });
  } catch {
    return null;
  }
});

const timingRoster = cache(async (sessionKey: number): Promise<OpenF1Driver[]> => {
  try {
    return await openf1.getDrivers(sessionKey, { strict: true, revalidate: 3600, lastGood: 'fallback' });
  } catch {
    return [];
  }
});

/**
 * Top three per finished session of the weekend, from OpenF1's final
 * classification (practice included). One roster (the latest finished
 * session's) names the drivers; a session whose top three is not on it (an
 * FP1 rookie) reads its own roster. Reads run one at a time to stay well
 * inside OpenF1's free rate limit; Next's data cache keeps them afterwards.
 */
interface FinalTiming {
  podiums: Partial<Record<string, string[]>>;
  colours: Record<string, string>;
  /** False when OpenF1 could not be read (its free feed refuses requests while any session is running). */
  readable: boolean;
  /** Finished sessions whose final classification could not be read this time. */
  unread: string[];
}

async function finalTiming(race: UiRace, now: number): Promise<FinalTiming> {
  const sessions = await timingSessions(race.season);
  if (!sessions) return { podiums: {}, colours: {}, readable: false, unread: [] };
  const none: FinalTiming = { podiums: {}, colours: {}, readable: true, unread: [] };
  const finished = race.sessions
    .map((slot) => ({ slot, match: matchTimingSession(slot.iso, sessions, slot.kind) }))
    .filter((x): x is { slot: (typeof race.sessions)[number]; match: OpenF1Session } => x.match !== null && sessionFinished(x.match, now));
  const latest = latestFinishedSession(finished.map((x) => x.match), now);
  if (!latest) return none;
  const roster = await timingRoster(latest.session_key);
  // Driver code -> official team colour, for the small team marks beside each code.
  const colours: Record<string, string> = {};
  for (const d of roster) {
    const colour = normaliseTeamColour(d.team_colour);
    if (colour && d.name_acronym) colours[d.name_acronym.trim().toUpperCase()] = colour;
  }
  const out: Partial<Record<string, string[]>> = {};
  const unread: string[] = [];
  for (const { slot, match } of finished) {
    const rows = await openf1.getSessionResult(match.session_key, { strict: true, revalidate: 600, lastGood: 'fallback', deferWrite }).catch(() => null);
    if (rows === null) { unread.push(slot.kind); continue; }
    if (!rows.length) continue;
    const codes = topThreeCodes(rows, roster) ?? (match.session_key !== latest.session_key ? topThreeCodes(rows, await timingRoster(match.session_key)) : null);
    if (codes) out[slot.kind] = codes;
  }
  return { podiums: out, colours, readable: true, unread };
}

/**
 * Team colours for the homepage: the shared timing join first, then the
 * roster of the standings season's most recent finished OpenF1 session.
 * Teams the feed does not describe keep the neutral colour.
 */
export const getHomeTeamColours = cache(async (): Promise<TeamColours> => {
  const shared = await getTeamColours().catch((): TeamColours => ({}));
  if (Object.keys(shared).length) return shared;
  const [standings, meta, calendar] = await Promise.all([getDriverStandings(), getStandingsSeason(), getCalendar()]);
  if (meta.season === null || meta.previousSeasonFinal || !standings.length) return {};
  const sessions = await timingSessions(meta.season);
  const latest = sessions ? latestFinishedSession(sessions, calendar.now) : null;
  if (!latest) return {};
  const roster = await timingRoster(latest.session_key);
  return teamColoursFromTiming(standings.map((d) => ({ constructorSlug: d.constructorSlug, code: d.driver.code })), roster);
});

export interface HomeWeekend {
  state: 'available' | 'unavailable' | 'none';
  now: number;
  season: number;
  race: UiRace | null;
  podiums: Partial<Record<string, string[]>>;
  /** Where each session's top three came from: the official classification or OpenF1's final timing. */
  podiumSource: Partial<Record<string, 'jolpica' | 'openf1'>>;
  /** Driver code -> team colour from the weekend's timing roster (empty when timing is unavailable). */
  codeColours: Record<string, string>;
  /** Sessions whose OpenF1 final timing could not be read on this request (every started one when the feed was unreadable). */
  timingUnread: string[];
  facts: CircuitFacts | null;
  photo: CreditedImage | null;
}

export const getHomeWeekend = cache(async (): Promise<HomeWeekend> => {
  const calendar = await getCalendar();
  const race = calendar.next;
  if (!race) return { state: calendar.state === 'unavailable' ? 'unavailable' : 'none', now: calendar.now, season: calendar.season, race: null, podiums: {}, podiumSource: {}, codeColours: {}, timingUnread: [], facts: null, photo: null };
  const [published, timing, factsMap, photo] = await Promise.all([
    publishedPodiums(race, calendar.now),
    finalTiming(race, calendar.now),
    loadCircuitFacts([race], { now: calendar.now }),
    getCircuitHeroImage({ circuitWikiUrl: race.circuitWikiUrl, circuitName: race.circuitName, revalidate: 86_400 }),
  ]);
  // The official Jolpica classification wins once published; OpenF1's final timing fills the gap until then.
  const podiums = { ...timing.podiums, ...published };
  const podiumSource: HomeWeekend['podiumSource'] = {};
  for (const kind of Object.keys(podiums)) podiumSource[kind] = published[kind]?.length ? 'jolpica' : 'openf1';
  // An unreadable feed leaves every started session without final timing: say so per row rather than "awaiting".
  const timingUnread = timing.readable
    ? timing.unread
    : race.sessions.filter((s) => { const start = sessionStartMs(s.iso); return start !== null && start <= calendar.now; }).map((s) => s.kind);
  return { state: 'available', now: calendar.now, season: calendar.season, race, podiums, podiumSource, codeColours: timing.colours, timingUnread, facts: factsMap.get(circuitFactsKey(race)) ?? null, photo };
});

export interface PodiumDriver {
  position: number;
  slug: string;
  firstName: string;
  lastName: string;
  team: string;
  color: string;
  headshot: string | null;
  portrait: string | null;
  time: string | null;
}

export interface LastRace {
  state: 'available' | 'unavailable' | 'none';
  race: UiRace | null;
  results: UiResult[];
  podium: PodiumDriver[];
  colours: Record<string, string>;
}

/**
 * The most recent Grand Prix with a published classification: today's race
 * once Jolpica publishes it, otherwise the previous round.
 */
export const getLastRace = cache(async (): Promise<LastRace> => {
  const calendar = await getCalendar();
  const candidates = lastRaceCandidates(calendar);
  if (!candidates.length) return { state: calendar.state === 'unavailable' ? 'unavailable' : 'none', race: null, results: [], podium: [], colours: {} };
  let race: UiRace | null = null;
  let results: UiResult[] = [];
  let unavailable = false;
  for (const candidate of candidates) {
    const read = await loadRaceResults(candidate);
    if (read.state === 'unavailable') { unavailable = true; continue; }
    if (read.results.length) { race = candidate; results = read.results; break; }
  }
  if (!race) return { state: unavailable ? 'unavailable' : 'none', race: candidates.at(-1) ?? null, results: [], podium: [], colours: {} };
  const [grid, colours] = await Promise.all([getGrid().catch((): GridDriver[] => []), getHomeTeamColours()]);
  const bySlug = new Map(grid.map((d) => [d.slug, d]));
  const podium = results.filter((r) => r.position >= 1 && r.position <= 3).sort((a, b) => a.position - b.position).map((r): PodiumDriver => {
    const g = bySlug.get(r.driver.slug);
    const slug = r.constructor?.slug ?? '';
    return {
      position: r.position,
      slug: r.driver.slug,
      firstName: decodeEntities(r.driver.firstName),
      lastName: decodeEntities(r.driver.lastName),
      team: decodeEntities(r.constructor?.name ?? ''),
      color: colours[slug] ?? g?.color ?? teamColorBySlug(slug, colours),
      headshot: g?.headshot ?? null,
      portrait: g?.portrait ?? null,
      time: r.time ?? null,
    };
  });
  const colourMap: Record<string, string> = {};
  for (const r of results) if (r.constructor) colourMap[r.constructor.slug] = teamColorBySlug(r.constructor.slug, colours);
  for (const d of grid) if (!colours[d.teamSlug]) colourMap[d.teamSlug] = d.color;
  return { state: 'available', race, results, podium, colours: colourMap };
});

export interface Championship {
  state: 'available' | 'unavailable' | 'none';
  season: number | null;
  round: number | null;
  previousSeasonFinal: boolean;
  drivers: Array<{ position: number; slug: string; name: string; firstName: string; lastName: string; code: string; team: string; teamSlug: string; color: string; points: number; wins: number }>;
  constructors: Array<{ position: number; slug: string; name: string; color: string; points: number; wins: number }>;
  constructorSeason: number | null;
  fight: TitleFight | null;
  nextRoundName: string | null;
}

export const getChampionship = cache(async (): Promise<Championship> => {
  const [drivers, constructors, meta, constructorMeta, colours, calendar] = await Promise.all([
    getDriverStandings(),
    getConstructorStandings(),
    getStandingsSeason(),
    getConstructorStandingsSeason(),
    getHomeTeamColours(),
    getCalendar(),
  ]);
  const rows = drivers.map((d) => ({
    position: d.position,
    slug: d.driver.slug,
    name: decodeEntities(d.driver.fullName),
    firstName: decodeEntities(d.driver.firstName),
    lastName: decodeEntities(d.driver.lastName),
    code: d.driver.code,
    team: decodeEntities(d.constructorName),
    teamSlug: d.constructorSlug,
    color: teamColorBySlug(d.constructorSlug, colours),
    points: d.points,
    wins: d.wins,
  }));
  const teams = constructors.map((c) => ({ position: c.position, slug: c.constructor.slug, name: decodeEntities(c.constructor.name), color: teamColorBySlug(c.constructor.slug, colours), points: c.points, wins: c.wins }));
  // Title maths only for the live table of the calendar's own season.
  const sameSeason = meta.season !== null && calendar.state === 'available' && calendar.season === meta.season && !meta.previousSeasonFinal;
  const fight = sameSeason && meta.round !== null
    ? titleFight(rows.map((r) => ({ name: r.lastName, points: r.points })), calendar.races.map((r) => ({ round: r.round, name: decodeEntities(r.name), sessions: r.sessions })), meta.round)
    : null;
  const state = rows.length ? 'available' : meta.state === 'unavailable' ? 'unavailable' : 'none';
  return {
    state,
    season: meta.season,
    round: meta.round,
    previousSeasonFinal: meta.previousSeasonFinal,
    drivers: rows,
    constructors: teams,
    constructorSeason: constructorMeta.season,
    fight,
    nextRoundName: fight?.decider?.round.name ?? null,
  };
});
