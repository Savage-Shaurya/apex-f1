import { jolpica, mapRace, type UiRace } from '@apex/api-client/jolpica';

type RaceContextProvider = Pick<typeof jolpica, 'getSchedule' | 'getDrivers'>;

/** Calendar and entry list change rarely; the database transaction stays the
 * authority for the qualifying deadline (it re-checks with its own clock). */
export const PREDICTION_SCHEDULE_TTL_S = 600;
export const PREDICTION_DRIVERS_TTL_S = 3600;

export interface PredictionRaceContext {
  race: UiRace | null;
  eligibleDriverIds: Set<string>;
}

/**
 * Race and entry-list check for one prediction save (BE-2).
 *
 * Uses the shared, process-cached Jolpica reads (10 min schedule, 1 h entry
 * list) instead of two fresh `revalidate: 0` requests per POST, so a burst of
 * saves costs at most two physical Jolpica requests per cache lifetime and
 * cannot exhaust the hourly budget the public pages depend on.
 */
export async function readPredictionRaceContext(season: number, round: number, provider: RaceContextProvider = jolpica): Promise<PredictionRaceContext> {
  const [schedule, drivers] = await Promise.all([
    provider.getSchedule(season, { revalidate: PREDICTION_SCHEDULE_TTL_S, strict: true }),
    provider.getDrivers(season, { revalidate: PREDICTION_DRIVERS_TTL_S, strict: true }),
  ]);
  return {
    race: schedule.map(mapRace).find((race) => race.round === round) ?? null,
    eligibleDriverIds: new Set(drivers.map((driver) => driver.driverId)),
  };
}
