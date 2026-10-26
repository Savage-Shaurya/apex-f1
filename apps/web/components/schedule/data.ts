import { jolpica } from '@apex/api-client/jolpica';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { optOutOnOutage } from '@/lib/grid';

export interface RoundWinner {
  /** FIA three-letter code as Jolpica publishes it; null for drivers without one (never made up from the surname). */
  code: string | null;
  name: string;
  teamSlug: string;
  teamName: string;
}

/** P1 of confirmed classifications; a failure cannot establish a pending result. */
export async function getRoundWinners(season: number): Promise<{ state: 'available' | 'unavailable'; winners: Map<number, RoundWinner> }> {
    const read = await readPublicSport(() => jolpica.getSeasonWinners(season, { ...SPORT_READ_OPTIONS, revalidate: 3600 }));
    if (read.state === 'unavailable') {
      await optOutOnOutage();
      return { state: 'unavailable', winners: new Map() };
    }
    const races = read.data;
    const map = new Map<number, RoundWinner>();
    for (const r of races) {
      const w = r.Results[0];
      if (!w) continue;
      map.set(Number(r.round), {
        code: w.Driver.code?.trim() || null,
        name: w.Driver.familyName,
        teamSlug: w.Constructor?.constructorId ?? '',
        teamName: w.Constructor?.name ?? '',
      });
    }
    return { state: 'available', winners: map };
}

/** Request-time clock for server renders (pages revalidate, so this is the render moment). */
export function requestNow(): number {
  return Date.now();
}
