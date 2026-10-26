/**
 * Known errors in provider championship tables, shown as visible source notes.
 *
 * Apex never rewrites a provider's numbers. When a provider table is known to
 * differ from the official classification, the page shows the table unchanged
 * with a note that says what the official result is (R3-DATA-4). Copy never
 * names the provider. Remove an entry once the provider corrects its data
 * (report: docs/audit/2026-10-26/round3/jolpica-report-2018.md in the workspace).
 * Render `constructorTableNote(season)?.table` on a season's constructors' table.
 */
export interface ConstructorTableNote {
  season: number;
  /** What the note says on the season's constructors' table. */
  table: string;
  /** Per team: the provider's place, the official place, and a one-line note for team pages. */
  teams: Readonly<Record<string, { provider: number; official: number; line: string }>>;
}

const NOTES: readonly ConstructorTableNote[] = [
  {
    season: 2018,
    table:
      "The official 2018 order differs from this table: Haas finished 5th (93 points) and McLaren 6th (62), because Force India's 59 points from rounds 1 to 12 were reset when the team was re-entered as Racing Point Force India mid-season (7th, 52 points). This table adds both together and ranks Force India 5th on 111.",
    teams: {
      haas: { provider: 6, official: 5, line: "2018: this record shows 6th; officially Haas finished 5th (93 points), because Force India's points were reset mid-season." },
      mclaren: { provider: 7, official: 6, line: "2018: this record shows 7th; officially McLaren finished 6th (62 points), because Force India's points were reset mid-season." },
      force_india: { provider: 5, official: 7, line: "2018: this record shows 5th on 111 points; officially the team's 59 points from rounds 1 to 12 were reset when it was re-entered as Racing Point Force India, which finished 7th on 52." },
    },
  },
];

/** The source note for a season's constructors' table, if the provider's table is known to be wrong. */
export function constructorTableNote(season: number): ConstructorTableNote | null {
  return NOTES.find((n) => n.season === season) ?? null;
}

/** Source notes for one team's championship record, for the seasons it appears in. */
export function teamRecordNotes(teamSlug: string, seasons: Iterable<number>): Array<{ season: number; line: string; provider: number; official: number }> {
  const wanted = new Set(seasons);
  return NOTES.flatMap((n) => {
    const team = n.teams[teamSlug];
    return team && wanted.has(n.season) ? [{ season: n.season, ...team }] : [];
  });
}

/** "Officially P5 in 2018" when a noted season's official place beats the provider-based best finish. */
export function officialBetter(notes: ReadonlyArray<{ season: number; official: number }>, best: number | null): string | null {
  const better = notes.filter((n) => best === null || n.official < best).sort((a, b) => a.official - b.official)[0];
  return better ? `Officially P${better.official} in ${better.season} (see note below)` : null;
}
