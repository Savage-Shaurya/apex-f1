import { notFound } from 'next/navigation';
import { resolveResultsSeason } from '@/components/results/season-route';

/**
 * Validates the season above the loading boundaries in drivers/ and teams/,
 * so /results/2031/teams answers HTTP 404 and /results/2026 a real 308.
 */
export default async function ResultsSeasonLayout({ children, params }: { children: React.ReactNode; params: Promise<{ season: string }> }) {
  const { season } = await params;
  if (!(await resolveResultsSeason(season))) notFound();
  return children;
}
