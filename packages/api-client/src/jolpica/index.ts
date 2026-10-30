export * from "./client";
export * from "./types";
export * from "./mappers";
export * from "./season";
export * from "./team-stints";
export type { JolpicaStaleFallback } from "./request-control";
// Outage classification for jobs that read Jolpica (cron resilience, 2026-10-31).
export { ProviderError, classifyProviderFailure, isProviderUnavailable, type ProviderFailureClass } from "../transport";
import { jolpicaRequestControl } from "./request-control";
import { JOLPICA_BASE } from "./client";
import { invalidateSharedJolpicaChampionships } from "./shared-admission";

/**
 * True when a process-cache key (a full request URL) belongs to `season`
 * (or Jolpica's `current` alias). The match is on the path relative to the
 * resolved base URL, so it also works behind the local development cache
 * (`/jolpica/2026.json`), not only on `/ergast/f1/2026.json`.
 */
export function jolpicaSeasonKeyMatches(key: string, season: number, current: boolean, base: string = JOLPICA_BASE): boolean {
  let url: URL;
  let root: URL;
  try { url = new URL(key); root = new URL(base); } catch { return false; }
  if (url.origin !== root.origin) return false;
  const prefix = root.pathname.replace(/\/$/, "");
  if (!url.pathname.startsWith(`${prefix}/`)) return false;
  const relative = url.pathname.slice(prefix.length);
  return new RegExp(`^/(?:${season}${current ? "|current" : ""})(?:/|\\.json$)`).test(relative);
}


/** Other deployment processes retain their bounded local TTL until their next refresh. */
export async function invalidateLocalJolpicaSeason(
  season: number,
  options: {
    /** True when Jolpica's `current` alias denotes this season (defaults to the calendar year). */
    current?: boolean;
    /** True when the season's final round is classified, so its champions may change. */
    finished?: boolean;
  } = {},
): Promise<void> {
  if (!Number.isInteger(season) || season < 1950 || season > 2200)
    throw new Error("Invalid cache season.");
  const current = options.current ?? season === new Date().getUTCFullYear();
  // Cross-process archive generations advance before local copies expire.
  // A failed shared invalidation must prevent a correction being declared done.
  await invalidateSharedJolpicaChampionships(season, undefined, { finished: options.finished });
  jolpicaRequestControl.invalidate((key) => jolpicaSeasonKeyMatches(key, season, current));
}
