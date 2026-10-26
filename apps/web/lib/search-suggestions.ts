/**
 * Offer only suggestions that resolve to at least one exact match in the
 * page's own corpus. Candidates come from live data (the search page passes
 * the championship leader, leading constructor, next race city and latest
 * completed season), never from a hard-coded list.
 */
export function matchingSearchSuggestions(candidates: readonly string[], resolves: (term: string) => boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const term = raw.trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    if (resolves(term)) out.push(term);
  }
  return out;
}

export interface LiveSuggestionInput {
  /** Current driver standings, leader first. */
  leaderSurname?: string;
  /** Current constructor standings leader. */
  leadingTeam?: string;
  races: Array<{ city: string; raceStartIso: string; season: number }>;
  seasons: Array<{ season: string }>;
}

/**
 * Candidate terms from this render's live data: the championship leader, the
 * leading constructor, the next race city (or the last one once the season is
 * over) and the latest completed season.
 */
export function liveSearchSuggestions(input: LiveSuggestionInput, now = Date.now()): string[] {
  const upcoming = input.races.find((race) => Date.parse(race.raceStartIso) > now) ?? input.races.at(-1);
  const currentSeason = input.races[0]?.season ?? Infinity;
  const completed = input.seasons.map((s) => Number(s.season)).filter((year) => Number.isFinite(year) && year < currentSeason);
  return [input.leaderSurname, input.leadingTeam, upcoming?.city, completed.length ? String(Math.max(...completed)) : undefined]
    .filter((term): term is string => Boolean(term?.trim()));
}
