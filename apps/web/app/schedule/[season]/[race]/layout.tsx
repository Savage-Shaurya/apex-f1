import { notFound } from 'next/navigation';
import { loadRaceCalendarCached } from '@/components/schedule/season-route';

/** An unknown race answers HTTP 404 before the loading skeleton streams (an outage still renders the page's honest unavailable state). */
export default async function RaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ season: string; race: string }> }) {
  const { season, race } = await params;
  const calendar = await loadRaceCalendarCached(Number(season), race);
  if (calendar.state === 'missing') notFound();
  return children;
}
