// A calendar focus window is a presentation rule, never proof of live status.
export const CALENDAR_FOCUS_WINDOW_MS = 3 * 3_600_000;

export function calendarFocusIndex(races: readonly { raceStartIso: string }[], now: number): number {
  if (!Number.isFinite(now)) return -1;
  return races.findIndex((race) => {
    const start = Date.parse(race.raceStartIso);
    return Number.isFinite(start) && start + CALENDAR_FOCUS_WINDOW_MS > now;
  });
}
