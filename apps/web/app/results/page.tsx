import { redirect } from 'next/navigation';
import { getSeasonContext } from '@/lib/season';

// Resolved per request so the target follows the live standings season.
export const dynamic = 'force-dynamic';

/** /results has no content of its own; it opens the live standings season's driver table (lib/season.ts, never the clock year). */
export default async function ResultsIndexPage() {
  const { resultsSeason, resultsSeasonConfirmed } = await getSeasonContext();
  // Without a confirmed season (Jolpica outage) the archive is the truthful target, not a guessed year (R3-REG-1).
  redirect(resultsSeasonConfirmed ? `/results/${resultsSeason}/drivers` : '/results/archive');
}
