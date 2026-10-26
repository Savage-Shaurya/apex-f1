/**
 * Pure presentation maths for the People pages (drivers, teams, champions).
 * No data access and no React: every function takes provider rows that the
 * page already loaded and returns view models, so the rules are testable.
 */
import { bestClassifiedFinish, primaryRaceResult } from '@/lib/career-stats';
import { decodeEntities, hasNoGridSlot } from '@/lib/format';

/** One Grand Prix as a driver or team page sees it (mapped Jolpica rows). */
export interface RaceRows {
  season: number;
  round: number;
  raceName: string;
  country: string;
  rows: ReadonlyArray<RaceRow>;
}

export interface RaceRow {
  position: number | null;
  positionText: string;
  points: number;
  grid: number | null;
  /** Laps completed; tells a pit-lane start (grid 0, laps run) from no grid slot. */
  laps?: number | null;
  status: string;
  fastestLap?: { rank: number } | undefined;
  driver: { slug: string; fullName: string; firstName?: string; lastName?: string; code?: string };
  constructor: { slug: string; name: string } | null;
}

export interface TeamRef {
  slug: string;
  name: string;
  color: string;
}

/** One race in a driver's career (the driver's primary row for that Grand Prix). */
export interface CareerRace {
  season: number;
  round: number;
  raceName: string;
  country: string;
  grid: number | null;
  /** Laps completed by the primary row; null when not published. */
  laps: number | null;
  /** Classified finish, null when not classified. */
  finish: number | null;
  positionText: string;
  status: string;
  points: number;
  fastestLap: boolean;
  team: TeamRef | null;
}

export interface CareerSeason {
  year: number;
  teams: TeamRef[];
  races: CareerRace[];
  starts: number;
  wins: number;
  podiums: number;
  points: number;
  best: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A driver's career grouped by season, oldest first. Shared drives (two rows
 * in one 1950s race) count once by the best classified row, but their points
 * are summed, matching lib/career-stats.
 */
export function careerSeasons(races: readonly RaceRows[], colourOf: (teamSlug: string, season: number) => string): CareerSeason[] {
  const bySeason = new Map<number, CareerRace[]>();
  for (const race of races) {
    const primary = primaryRaceResult(race.rows);
    if (!primary) continue;
    const finish = bestClassifiedFinish([primary]);
    const list = bySeason.get(race.season) ?? [];
    list.push({
      season: race.season,
      round: race.round,
      raceName: race.raceName,
      country: race.country,
      grid: race.rows.some((r) => r.grid === 1) ? 1 : primary.grid,
      laps: primary.laps ?? null,
      finish,
      positionText: primary.positionText,
      status: primary.status,
      points: round2(race.rows.reduce((s, r) => s + (Number.isFinite(r.points) ? r.points : 0), 0)),
      fastestLap: race.rows.some((r) => r.fastestLap?.rank === 1),
      team: primary.constructor ? { slug: primary.constructor.slug, name: decodeEntities(primary.constructor.name), color: colourOf(primary.constructor.slug, race.season) } : null,
    });
    bySeason.set(race.season, list);
  }
  return Array.from(bySeason.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, list]) => {
      const sorted = list.slice().sort((a, b) => a.round - b.round);
      const teams: TeamRef[] = [];
      for (const r of sorted) if (r.team && !teams.some((t) => t.slug === r.team!.slug)) teams.push(r.team);
      return {
        year,
        teams,
        races: sorted,
        starts: sorted.length,
        wins: sorted.filter((r) => r.finish === 1).length,
        podiums: sorted.filter((r) => r.finish !== null && r.finish <= 3).length,
        points: round2(sorted.reduce((s, r) => s + r.points, 0)),
        best: sorted.reduce<number | null>((b, r) => (r.finish !== null && (b === null || r.finish < b) ? r.finish : b), null),
      };
    });
}

/** Finish band for a heatmap cell: a word, not only a tone. */
export type FinishBand = 'win' | 'podium' | 'points' | 'finish' | 'out';
export function finishBand(race: Pick<CareerRace, 'finish' | 'points'>): FinishBand {
  if (race.finish === null) return 'out';
  if (race.finish === 1) return 'win';
  if (race.finish <= 3) return 'podium';
  if (race.finish <= 10 || race.points > 0) return 'points';
  return 'finish';
}

/** Records computable from results alone (null when there is nothing to show). */
export function careerRecords(seasons: readonly CareerSeason[]) {
  const races = seasons.flatMap((s) => s.races);
  const firstWin = races.find((r) => r.finish === 1) ?? null;
  const firstStartP1 = races.find((r) => r.grid === 1) ?? null;
  const bestSeason = seasons.reduce<CareerSeason | null>((b, s) => (s.wins > 0 && (!b || s.wins > b.wins) ? s : b), null);
  let streak = 0;
  let longest = 0;
  for (const r of races) {
    streak = r.points > 0 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  return { firstWin, firstStartP1, bestSeason, longestPointsStreak: longest };
}

/**
 * Team-mate comparison over the races both drivers started for the same
 * team. "Ahead at the finish" compares classified finishes only; the grid
 * comparison uses the Grand Prix starting grid (a pit-lane start, grid 0,
 * counts as behind), which is labelled as such on the page.
 */
export interface DuelSide {
  slug: string;
  name: string;
  finishAhead: number;
  gridAhead: number;
  points: number;
  best: number | null;
  wins: number;
}
export interface Duel {
  races: number;
  /** Races where both were classified (denominator for finishAhead). */
  bothClassified: number;
  /** Races where both had a starting grid slot (denominator for gridAhead). */
  bothGridded: number;
  a: DuelSide;
  b: DuelSide;
}

export function teamMateDuel(races: readonly RaceRows[], aSlug: string, bSlug: string): Duel | null {
  const side = (slug: string): DuelSide => ({ slug, name: '', finishAhead: 0, gridAhead: 0, points: 0, best: null, wins: 0 });
  const a = side(aSlug);
  const b = side(bSlug);
  let shared = 0;
  let bothClassified = 0;
  let bothGridded = 0;
  // A pit-lane start ranks behind every grid slot; grid 0 with no lap run is no grid slot at all (R3-DATA-3).
  const gridValue = (row: RaceRow) => (row.grid === null || hasNoGridSlot(row) ? null : row.grid === 0 ? 99 : row.grid);
  for (const race of races) {
    const ra = primaryRaceResult(race.rows.filter((r) => r.driver.slug === aSlug));
    const rb = primaryRaceResult(race.rows.filter((r) => r.driver.slug === bSlug));
    for (const [row, s] of [[ra, a], [rb, b]] as const) {
      if (!row) continue;
      s.name ||= row.driver.fullName;
      s.points += row.points;
      const f = bestClassifiedFinish([row]);
      if (f !== null && (s.best === null || f < s.best)) s.best = f;
      if (f === 1) s.wins++;
    }
    if (!ra || !rb) continue;
    shared++;
    const fa = bestClassifiedFinish([ra]);
    const fb = bestClassifiedFinish([rb]);
    if (fa !== null && fb !== null) {
      bothClassified++;
      if (fa < fb) a.finishAhead++;
      else if (fb < fa) b.finishAhead++;
    }
    const ga = gridValue(ra);
    const gb = gridValue(rb);
    if (ga !== null && gb !== null) {
      bothGridded++;
      if (ga < gb) a.gridAhead++;
      else if (gb < ga) b.gridAhead++;
    }
  }
  if (!shared) return null;
  a.points = round2(a.points);
  b.points = round2(b.points);
  return { races: shared, bothClassified, bothGridded, a, b };
}

/** The two drivers with the most starts for a team in a set of races (the regular pairing). */
export function regularPair(races: readonly RaceRows[]): [string, string] | null {
  const starts = new Map<string, number>();
  for (const race of races) for (const r of race.rows) starts.set(r.driver.slug, (starts.get(r.driver.slug) ?? 0) + 1);
  const top = Array.from(starts.entries()).sort((x, y) => y[1] - x[1]);
  return top.length >= 2 ? [top[0]![0], top[1]![0]] : null;
}

/** Title years as runs: [2008, 2014, 2015, 2017, 2018, 2019, 2020] -> "2008, 2014–15, 2017–20". */
export function yearRuns(years: readonly number[]): string {
  const sorted = Array.from(new Set(years)).sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    const from = sorted[i]!;
    const to = sorted[j]!;
    runs.push(from === to ? String(from) : `${from}–${String(to).slice(Math.floor(from / 100) === Math.floor(to / 100) ? 2 : 0)}`);
    i = j + 1;
  }
  return runs.join(', ');
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** Group rows by decade, newest decade first, rows inside newest first. */
export function byDecade<T extends { year: number }>(rows: readonly T[]): Array<{ decade: number; rows: T[] }> {
  const map = new Map<number, T[]>();
  for (const row of rows) {
    const d = decadeOf(row.year);
    map.set(d, [...(map.get(d) ?? []), row]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b - a)
    .map(([decade, list]) => ({ decade, rows: list.slice().sort((a, b) => b.year - a.year) }));
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Directory letter for a name: the first A–Z letter of the folded family name ("de Graffenried" -> G, "Ó" -> O). */
export function indexLetter(familyName: string): string {
  const words = fold(familyName).trim().split(/\s+/);
  const particle = /^(de|da|di|del|della|van|von|der|den|le|la|du|dos|das|zu)$/i;
  const main = words.find((w) => !particle.test(w)) ?? words[0] ?? '';
  const letter = main.toUpperCase().match(/[A-Z]/)?.[0];
  return letter ?? '#';
}

/** Search key: lower case, no accents, single spaces. */
export function searchKey(value: string): string {
  return fold(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Display step for a surname so it never clips: display-xl holds about nine
 * capitals on a 320px phone (DS 4.2), display-l about fourteen.
 */
export function surnameStep(lastName: string): 'display-xl' | 'display-l' | 'display-m' {
  const longestWord = Math.max(...lastName.split(/[\s-]+/).map((w) => w.length));
  if (longestWord <= 9 && lastName.length <= 12) return 'display-xl';
  if (longestWord <= 13) return 'display-l';
  return 'display-m';
}

/** "Lotus-Pratt &amp; Whitney" -> "Lotus-Pratt & Whitney". */
export function cleanName(name: string | null | undefined): string {
  return decodeEntities(name ?? '').trim();
}

/** Race name in full: never shortened ("Bahrain Grand Prix in Malaysia" stays whole). */
export function raceLabel(raceName: string): string {
  return decodeEntities(raceName).trim();
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Points as written on a timing sheet: integers plain, halves with one decimal. */
export function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(points * 10 === Math.round(points * 10) ? 1 : 2);
}

/** The teams of a career in the order first driven for: "Toleman, Lotus, McLaren, Williams" ("and 3 more" past `max`). */
export function teamsLine(seasons: readonly CareerSeason[], max = 4): string {
  const names: string[] = [];
  for (const s of seasons) for (const t of s.teams) if (!names.includes(t.name)) names.push(t.name);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * A birthplace as a reader expects it. Wikidata's place of birth is sometimes
 * the building ("maternity hospital of São Paulo"); the city is the honest,
 * readable part of that label. Anything else is returned unchanged.
 */
export function placeLabel(place: string | null | undefined): string | null {
  const text = place?.trim();
  if (!text) return null;
  const m = /^(?:the\s+)?[^,]*?\b(?:hospital|clinic|maternity|infirmary)\b[^,]*?\s(?:of|in)\s+(.+)$/i.exec(text);
  return m ? m[1]!.trim() : text;
}

/**
 * Jolpica stores Wikipedia links as http://. Reference links (visible and in
 * JSON-LD sameAs) go out over https for Wikimedia hosts; any other URL is
 * returned unchanged, and an empty value stays null.
 */
export function secureReferenceUrl(url: string | null | undefined): string | null {
  const text = url?.trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol === 'http:' && /(^|\.)(wikipedia|wikidata|wikimedia)\.org$/i.test(u.hostname)) u.protocol = 'https:';
    return u.toString();
  } catch {
    return text;
  }
}

/** True when the provider status means the car took the chequered flag (on the lead lap or lapped). */
export function tookTheFlag(status: string | null | undefined): boolean {
  const s = status?.trim() ?? '';
  return s === '' || /^finished$/i.test(s) || /^\+\d+\s+laps?$/i.test(s) || /^lapped$/i.test(s);
}

/**
 * Screen-reader and visible wording for a result. A driver can be classified
 * (given a position) without finishing: "P20, classified, retired" says both,
 * never "finished P20".
 */
export function resultWords(race: Pick<CareerRace, 'finish' | 'status' | 'positionText'>): string {
  if (race.finish === null) return race.status || race.positionText || 'Not classified';
  return tookTheFlag(race.status) ? `Finished P${race.finish}` : `Classified P${race.finish}, ${race.status.toLowerCase()}`;
}

/**
 * The directory's query string: q, letter and nationality set when present,
 * removed when empty, every other parameter kept. Returns "" or "?…".
 */
export function directorySearch(current: URLSearchParams, state: { q: string; letter: string; nationality: string }): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(state)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const text = next.toString();
  return text ? `?${text}` : '';
}
