/**
 * Pure team-season maths from Jolpica constructor results (both cars).
 * Points are Grand Prix points only (sprint races are separate in Jolpica).
 */
import { bestClassifiedFinish } from '@/lib/career-stats';
import type { RaceRows } from '@/components/drivers/people';

export interface TeamSeason {
  year: number;
  races: number;
  wins: number;
  podiums: number;
  /** Races where both cars finished first and second. */
  oneTwos: number;
  points: number;
  best: number | null;
  drivers: Array<{ slug: string; name: string; starts: number }>;
}

export function teamSeasons(windows: ReadonlyArray<{ year: number; races: readonly RaceRows[] }>): TeamSeason[] {
  return windows
    .filter((w) => w.races.length > 0)
    .map((w) => {
      let wins = 0, podiums = 0, oneTwos = 0, points = 0;
      let best: number | null = null;
      const drivers = new Map<string, { slug: string; name: string; starts: number }>();
      for (const race of w.races) {
        const finishes: number[] = [];
        for (const row of race.rows) {
          points += Number.isFinite(row.points) ? row.points : 0;
          const f = bestClassifiedFinish([row]);
          if (f !== null) {
            finishes.push(f);
            if (f === 1) wins++;
            if (f <= 3) podiums++;
            if (best === null || f < best) best = f;
          }
          const d = drivers.get(row.driver.slug) ?? { slug: row.driver.slug, name: row.driver.fullName, starts: 0 };
          d.starts++;
          drivers.set(row.driver.slug, d);
        }
        if (finishes.includes(1) && finishes.includes(2)) oneTwos++;
      }
      return {
        year: w.year,
        races: w.races.length,
        wins,
        podiums,
        oneTwos,
        points: Math.round(points * 100) / 100,
        best,
        drivers: Array.from(drivers.values()).sort((a, b) => b.starts - a.starts),
      };
    })
    .sort((a, b) => b.year - a.year);
}
