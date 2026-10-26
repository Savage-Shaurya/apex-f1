import { unstable_cache } from "next/cache";
import {
  jolpica,
  type JolpicaDriverStandingEntry,
  type JolpicaConstructorStandingEntry,
} from "@apex/api-client/jolpica";
import {
  ProviderError,
  withProviderDeadline,
} from "../../../../packages/api-client/src/transport";
import {
  ChampionNotPublished,
  ChampionshipReadGate,
  readChampionshipArchive,
  type ChampionshipArchive,
} from "@/lib/championship-archive";
import {
  CHAMPIONSHIP_SNAPSHOT_THROUGH,
  CONSTRUCTOR_CHAMPIONSHIP_FROM,
  DRIVER_CHAMPIONSHIP_FROM,
  snapshotConstructorChampions,
  snapshotDriverChampions,
} from "@/lib/championship-snapshot";

export const championshipCacheTags = (
  kind: "driver" | "constructor",
  year: number,
) => [`jolpica:season:${year}`, `jolpica:championship:${kind}`];
const winnerReads = new ChampionshipReadGate();
const remainingReadBudget = (deadline: number) =>
  Math.max(1, Math.min(6_000, deadline - Date.now()));

/** Completed-year winners automatically refresh after seven days.
 * A fully warm archive within that TTL makes zero provider reads.
 * Expire the season tag with expire:0, plus both champions paths, after a source
 * correction. Only validated winners return from these cache callbacks. */
async function driverWinner(
  year: number,
  deadline: number,
  callerSignal?: AbortSignal,
): Promise<JolpicaDriverStandingEntry | null> {
  try {
    const verified = await unstable_cache(
      async () =>
        withProviderDeadline(
          "jolpica",
          (signal) =>
            winnerReads.run(
              async () => {
                const remaining = remainingReadBudget(deadline);
                const snapshot = await jolpica.getDriverChampionSnapshot(year, {
                  strict: true,
                  revalidate: 0,
                  timeoutMs: remaining,
                  deadlineMs: remaining,
                  signal,
                });
                const winner = snapshot.standings[0];
                if (!winner) throw new ChampionNotPublished();
                if (signal.aborted)
                  throw new ProviderError("jolpica", "timeout");
                return {
                  winner,
                  season: year,
                  round: snapshot.round,
                  observedAt: new Date().toISOString(),
                  source: `https://api.jolpi.ca/ergast/f1/${year}/driverStandings/1.json`,
                };
              },
              signal,
              deadline,
            ),
          { signal: callerSignal, timeoutMs: remainingReadBudget(deadline) },
        ),
      ["apex-completed-driver-winner-v1", String(year)],
      { revalidate: 604800, tags: championshipCacheTags("driver", year) },
    )();
    return verified.winner;
  } catch (error) {
    if (error instanceof ChampionNotPublished) return null;
    throw error;
  }
}

async function constructorWinner(
  year: number,
  deadline: number,
  callerSignal?: AbortSignal,
): Promise<JolpicaConstructorStandingEntry | null> {
  try {
    const verified = await unstable_cache(
      async () =>
        withProviderDeadline(
          "jolpica",
          (signal) =>
            winnerReads.run(
              async () => {
                const remaining = remainingReadBudget(deadline);
                const snapshot = await jolpica.getConstructorChampionSnapshot(
                  year,
                  {
                    strict: true,
                    revalidate: 0,
                    timeoutMs: remaining,
                    deadlineMs: remaining,
                    signal,
                  },
                );
                const winner = snapshot.standings[0];
                if (!winner) throw new ChampionNotPublished();
                if (signal.aborted)
                  throw new ProviderError("jolpica", "timeout");
                return {
                  winner,
                  season: year,
                  round: snapshot.round,
                  observedAt: new Date().toISOString(),
                  source: `https://api.jolpi.ca/ergast/f1/${year}/constructorStandings/1.json`,
                };
              },
              signal,
              deadline,
            ),
          { signal: callerSignal, timeoutMs: remainingReadBudget(deadline) },
        ),
      ["apex-completed-constructor-winner-v1", String(year)],
      { revalidate: 604800, tags: championshipCacheTags("constructor", year) },
    )();
    return verified.winner;
  } catch (error) {
    if (error instanceof ChampionNotPublished) return null;
    throw error;
  }
}

type ArchiveOptions = {
  budgetMs?: number;
  signal?: AbortSignal;
  /** Serve the snapshot only up to this season (never beyond the file's own `through`); later seasons are read live. Tests use it to exercise the live path. */
  snapshotThrough?: number;
};

/**
 * Seasons up to the snapshot come from the verbatim Jolpica snapshot (zero
 * provider reads, so the archive is complete and instant). Only completed
 * seasons after it are read live, one cached request per season. A failed
 * live read leaves that season missing (partial archive), never a guessed
 * champion.
 */
async function archive<T>(
  first: number,
  through: number,
  snapshot: (to: number) => Array<{ year: number; winner: T }>,
  live: (from: number) => Promise<ChampionshipArchive<T>>,
  snapshotThrough = CHAMPIONSHIP_SNAPSHOT_THROUGH,
): Promise<ChampionshipArchive<T>> {
  // lastCompletedSeason() may equal the calendar year after the finale; never later.
  if (!Number.isSafeInteger(through) || through < first || through > new Date().getUTCFullYear())
    throw new ProviderError("jolpica", "invalid-input");
  const liveFrom = Math.max(first, Math.min(snapshotThrough, CHAMPIONSHIP_SNAPSHOT_THROUGH) + 1);
  const stored = snapshot(Math.min(through, liveFrom - 1));
  if (through < liveFrom)
    return { state: "complete", records: stored, missing: [], unavailable: [], through };
  const fresh = await live(liveFrom);
  if (!stored.length) return fresh;
  const records = [...fresh.records, ...stored];
  return {
    state: fresh.missing.length ? "partial" : "complete",
    records,
    missing: fresh.missing,
    unavailable: fresh.unavailable,
    through,
  };
}

export async function loadDriverChampionshipArchive(
  through: number,
  options: ArchiveOptions = {},
) {
  return archive(DRIVER_CHAMPIONSHIP_FROM, through, snapshotDriverChampions, (from) =>
    readChampionshipArchive(
      "driver",
      through,
      (year, _signal, deadline) => driverWinner(year, deadline, options.signal),
      { ...options, from },
    ),
    options.snapshotThrough,
  );
}
export async function loadConstructorChampionshipArchive(
  through: number,
  options: ArchiveOptions = {},
) {
  return archive(CONSTRUCTOR_CHAMPIONSHIP_FROM, through, snapshotConstructorChampions, (from) =>
    readChampionshipArchive(
      "constructor",
      through,
      (year, _signal, deadline) =>
        constructorWinner(year, deadline, options.signal),
      { ...options, from },
    ),
    options.snapshotThrough,
  );
}
