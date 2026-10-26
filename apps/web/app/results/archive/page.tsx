import type { Metadata } from 'next';
import { jolpica } from '@apex/api-client/jolpica';
import { loadConstructorChampionshipArchive, loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { ArchiveView } from '@/components/results/ArchiveView';
import raw from '@/lib/data/championship-snapshot.json';
import { validateChampionshipSnapshot } from '@/lib/championship-snapshot';
import { getCalendar, getConstructorStandings, getConstructorStandingsSeason, getDriverStandings, getStandingsSeason } from '@/lib/grid';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { getSeasonContext } from '@/lib/season';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const { resultsSeason } = await getSeasonContext();
  const count = resultsSeason - 1950 + 1;
  return withSocial({
    title: `Every Formula 1 season, 1950 to ${resultsSeason}`,
    description: `All ${count} Formula 1 World Championship seasons from 1950 to ${resultsSeason}: each season's drivers' and constructors' champions, number of rounds, calendar and full standings.`,
    alternates: { canonical: '/results/archive' },
  });
}

/** Rounds per completed season: the round of each season's final standings, captured verbatim from Jolpica. */
const SNAPSHOT = validateChampionshipSnapshot(raw);
const ROUNDS = new Map(SNAPSHOT.drivers.map((row) => [row.year, row.round]));

export default async function ResultsArchivePage() {
  // The season whose standings are live and the last completed one (lib/season.ts, never the clock year).
  const ctx = await getSeasonContext();
  const current = ctx.resultsSeason;
  const [seasonsRead, drivers, constructors, calendar, live, liveTable, liveTeams, liveTeamTable] = await Promise.all([
    readPublicSport(() => jolpica.getSeasons({ ...SPORT_READ_OPTIONS, revalidate: 86400 })),
    loadDriverChampionshipArchive(ctx.lastCompletedSeason).catch(() => null),
    loadConstructorChampionshipArchive(ctx.lastCompletedSeason).catch(() => null),
    getCalendar(),
    getStandingsSeason(),
    getDriverStandings().catch(() => []),
    getConstructorStandingsSeason(),
    getConstructorStandings().catch(() => []),
  ]);

  // Seasons: Jolpica's list when it answers, else the confirmed range 1950..current.
  const listed = seasonsRead.state === 'available' ? seasonsRead.data.map((s) => Number(s.season)).filter((y) => Number.isInteger(y) && y >= 1950 && y <= current) : [];
  const years = listed.length ? [...new Set(listed)].sort((a, b) => a - b) : Array.from({ length: current - 1950 + 1 }, (_, i) => 1950 + i);
  const driverChamp = new Map(drivers?.records.map((r) => [r.year, r.winner]) ?? []);
  const teamChamp = new Map(constructors?.records.map((r) => [r.year, r.winner]) ?? []);
  const inProgress = current > ctx.lastCompletedSeason ? current : null;
  const currentRounds = calendar.season === current && calendar.races.length ? calendar.races.length : null;
  const leader = live.season === current ? liveTable[0] : undefined;
  const teamLeader = liveTeams.season === current ? liveTeamTable[0] : undefined;

  const seasons = years.map((year) => {
    const d = driverChamp.get(year);
    const c = teamChamp.get(year);
    return {
      year,
      rounds: year === inProgress ? currentRounds : ROUNDS.get(year) ?? null,
      champion: d ? `${d.Driver.givenName} ${d.Driver.familyName}` : null,
      championTeam: d?.Constructors?.[0]?.name ?? null,
      constructor: c ? c.Constructor.name : null,
      current: year === inProgress,
    };
  });
  const missing = seasons.filter((s) => !s.current && !s.champion).length;
  // An outage render must not be kept by ISR for a day (D2-RESILIENCE-4): render it per request instead.
  if (seasonsRead.state === 'unavailable' || !drivers || !constructors || missing > 0) await outageConnection();

  return (
    <ArchiveView
      seasons={seasons}
      current={current}
      leader={leader ? `${leader.driver.firstName} ${leader.driver.lastName}` : null}
      teamLeader={teamLeader ? teamLeader.constructor.name : null}
      missing={missing}
    />
  );
}
