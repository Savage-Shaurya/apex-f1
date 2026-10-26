/**
 * A constructor's place in every Constructors' Championship, from Jolpica's
 * per-season constructor standings (pure; the reads live in
 * components/teams/data/standings-archive.ts).
 *
 * Jolpica files early entries under engine-suffixed ids ("lotus-climax",
 * "brabham-repco"). The marque pages that lib/constructor-titles folds those
 * titles into (team_lotus, brabham, cooper, matra) also fold their suffixed
 * standings rows here, and each row names the entrant when it differs, so a
 * reader can see exactly what was counted.
 */
import { CONSTRUCTOR_TITLE_ALIASES } from '@/lib/constructor-titles';

export interface StandingEntry {
  position?: string;
  positionText: string;
  points: string;
  wins: string;
  Constructor: { constructorId: string; name: string };
}

export interface SeasonTable {
  year: number;
  /** Round the table stands after (the final round for a completed season). */
  round: number | null;
  entries: readonly StandingEntry[];
}

export interface HistoryRow {
  year: number;
  /** Best classified place among the team's entries; null when unranked. */
  position: number | null;
  positionText: string;
  points: number;
  /** Wins across every entry folded into the team that season. */
  wins: number;
  /** Entrant names when they differ from the team's own id ("Lotus-Climax"). */
  entrants: string[];
  round: number | null;
}

/** Ids folded into a marque: the id itself plus `<id>-<engine>` and aliased `<marque>-<engine>` entrants ("mclaren-ford" is McLaren). */
export function marqueMatcher(slug: string): (constructorId: string) => boolean {
  const prefixes = Array.from(new Set([`${slug}-`, ...Object.entries(CONSTRUCTOR_TITLE_ALIASES).filter(([, to]) => to === slug).map(([from]) => `${from.split('-')[0]}-`)]));
  return (id) => id === slug || prefixes.some((p) => id.startsWith(p));
}

export function championshipHistory(slug: string, tables: readonly SeasonTable[]): HistoryRow[] {
  const matches = marqueMatcher(slug);
  const rows: HistoryRow[] = [];
  for (const table of tables) {
    const mine = table.entries.filter((e) => matches(e.Constructor.constructorId));
    if (!mine.length) continue;
    const ranked = mine.slice().sort((a, b) => rank(a) - rank(b));
    const best = ranked[0]!;
    const position = Number.isSafeInteger(Number(best.position)) && Number(best.position) > 0 ? Number(best.position) : null;
    rows.push({
      year: table.year,
      position,
      positionText: position !== null ? `P${position}` : STATUS[best.positionText] ?? (best.positionText || 'Unranked'),
      points: Number(best.points) || 0,
      wins: mine.reduce((n, e) => n + (Number(e.wins) || 0), 0),
      entrants: Array.from(new Set(mine.filter((e) => e.Constructor.constructorId !== slug).map((e) => e.Constructor.name))),
      round: table.round,
    });
  }
  return rows.sort((a, b) => b.year - a.year);
}

/** Jolpica's non-numeric places, in words. */
const STATUS: Readonly<Record<string, string>> = { E: 'Excluded', D: 'Disqualified', '-': 'Unranked' };

function rank(e: StandingEntry): number {
  const n = Number(e.position);
  return Number.isSafeInteger(n) && n > 0 ? n : 999;
}

export interface HistorySummary {
  seasons: number;
  first: number | null;
  last: number | null;
  best: number | null;
  /** Seasons finished at `best`. */
  bestCount: number;
  wins: number;
  podiumSeasons: number;
}

export function historySummary(rows: readonly HistoryRow[]): HistorySummary {
  const ranked = rows.filter((r) => r.position !== null);
  const best = ranked.length ? Math.min(...ranked.map((r) => r.position!)) : null;
  return {
    seasons: rows.length,
    first: rows.length ? Math.min(...rows.map((r) => r.year)) : null,
    last: rows.length ? Math.max(...rows.map((r) => r.year)) : null,
    best,
    bestCount: best === null ? 0 : ranked.filter((r) => r.position === best).length,
    wins: rows.reduce((n, r) => n + r.wins, 0),
    podiumSeasons: ranked.filter((r) => r.position! <= 3).length,
  };
}
