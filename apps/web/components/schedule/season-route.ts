import { cache } from 'react';
import { loadRaceCalendar } from '@/lib/race-detail';

/** 1950 to one season beyond the newest calendar (published early); anything further is not a season yet. */
export function parseScheduleSeason(raw: string, newest: number): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1950 && n <= newest + 1 ? n : null;
}

/**
 * One render shares the calendar result (including outages) across the race
 * layout, metadata and page. The layout checks it above the loading boundary,
 * so an unknown race answers a real 404 instead of a streamed 200.
 */
export const loadRaceCalendarCached = cache((season: number, key: string) => loadRaceCalendar(season, key));
