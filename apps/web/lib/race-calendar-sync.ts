import type { UiRace } from "@apex/api-client/jolpica";

const SESSION_KINDS = new Set(["FP1", "FP2", "FP3", "SQ", "S", "Q", "R"]);

/** Validate the complete snapshot before starting idempotent, stable-identity writes. */
export async function persistRaceCalendar(
  races: UiRace[],
  year: number,
  operations: {
    persist(race: UiRace): Promise<{ raceId: string }>;
    expiresAt: number;
    now?: () => number;
    onProgress?: (counts: {
      racesPersisted: number;
      sessionsScheduled: number;
    }) => void;
  },
): Promise<{ racesPersisted: number; sessionsScheduled: number }> {
  if (
    !races.length ||
    races.length > 30 ||
    new Set(races.map((race) => race.round)).size !== races.length ||
    races.some(
      (race) =>
        race.season !== year ||
        !Number.isInteger(race.round) ||
        race.round < 1 ||
        race.round > 30 ||
        !race.slug ||
        !race.circuitId ||
        !Number.isFinite(Date.parse(race.raceStartIso)) ||
        new Set(race.sessions.map((session) => session.kind)).size !==
          race.sessions.length ||
        !race.sessions.some((session) => session.kind === "R") ||
        race.sessions.some(
          (session) =>
            !SESSION_KINDS.has(session.kind) ||
            !Number.isFinite(Date.parse(session.iso)),
        ),
    )
  )
    throw new Error(
      "Current-season calendar is incomplete, duplicated or has an invalid race identity.",
    );
  let racesPersisted = 0;
  let sessionsScheduled = 0;
  const now = operations.now ?? Date.now;
  for (const race of [...races].sort((a, b) => a.round - b.round)) {
    if (now() >= operations.expiresAt)
      throw new Error(
        `Calendar budget exhausted after ${racesPersisted}/${races.length} races; rerun resumes stable rows.`,
      );
    await operations.persist(race);
    racesPersisted++;
    sessionsScheduled += race.sessions.filter((session) =>
      /T\d{2}:\d{2}/.test(session.iso),
    ).length;
    operations.onProgress?.({ racesPersisted, sessionsScheduled });
  }
  return { racesPersisted, sessionsScheduled };
}
