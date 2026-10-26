import { notFound } from 'next/navigation';
import { parseScheduleSeason } from '@/components/schedule/season-route';
import { getSeasonContext } from '@/lib/season';

/**
 * Validates the season above the route's loading boundaries: an unknown
 * season answers HTTP 404, not a streamed "not found" page with status 200.
 */
export default async function SeasonLayout({ children, params }: { children: React.ReactNode; params: Promise<{ season: string }> }) {
  const { season } = await params;
  const ctx = await getSeasonContext();
  if (parseScheduleSeason(season, ctx.calendarSeason ?? ctx.activeSeason) === null) notFound();
  return children;
}
