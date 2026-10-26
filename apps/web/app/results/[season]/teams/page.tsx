import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StandingsView } from '@/components/results/StandingsView';
import { currentResultsSeasonParams, resolveResultsSeason as resolveSeason, standingsTableAnswers } from '@/components/results/season-route';
import { CONSTRUCTORS_FROM } from '@/components/results/data';
import { withSocial } from '@/lib/page-metadata';

export const revalidate = 300;
// ISR for every path. The current season is prebuilt (it always has a good cached copy that
// survives a provider outage); other seasons render on their first visit and are then cached.
export async function generateStaticParams() {
  return currentResultsSeasonParams(undefined, {}, standingsTableAnswers('teams'));
}

export async function generateMetadata(props: { params: Promise<{ season: string }> }): Promise<Metadata> {
  const { season } = await props.params;
  const s = await resolveSeason(season);
  if (!s) return withSocial({ title: 'Season not found', robots: { index: false, follow: true } });
  if (s.season < CONSTRUCTORS_FROM) {
    // No constructors' title before 1958 (SEO-6): the page explains that, and stays out of the index.
    return withSocial({
      title: `No constructors' championship in ${s.season}`,
      description: `The Formula 1 constructors' championship was first awarded in ${CONSTRUCTORS_FROM}. See the ${s.season} drivers' championship instead.`,
      robots: { index: false, follow: true },
    });
  }
  return withSocial({
    title: `${s.season} Formula 1 constructors' championship standings`,
    description: `The ${s.season} Formula 1 constructors' championship table with points, wins and the gap to the leader, plus how the title fight developed round by round.`,
    alternates: { canonical: `/results/${s.season}/teams` },
  });
}

export default async function ConstructorsStandingsPage(props: { params: Promise<{ season: string }> }) {
  const { season } = await props.params;
  const s = await resolveSeason(season);
  if (!s) notFound();
  return <StandingsView kind="teams" season={s.season} newestSeason={s.newest} />;
}
