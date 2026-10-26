import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { jolpica, mapRace } from '@apex/api-client/jolpica';
import { Breadcrumbs, Heading, Section, Unavailable } from '@/components/ds';
import { SeasonCalendar } from '@/components/schedule/SeasonCalendar';
import { getRoundWinners, requestNow } from '@/components/schedule/data';
import { makeColourOf } from '@/components/race/ResultsSheet';
import { loadCircuitFacts } from '@/lib/circuits/facts';
import { getStandingsSeason, getTeamColours } from '@/lib/grid';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { getSeasonContext } from '@/lib/season';
import { parseScheduleSeason } from '@/components/schedule/season-route';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

export const revalidate = 3600;
// ISR for every path: none is built ahead, each is rendered on its first visit and then
// served from cache for `revalidate` seconds. Without this export the route renders per request.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata(props: { params: Promise<{ season: string }> }): Promise<Metadata> {
  const { season } = await props.params;
  const ctx = await getSeasonContext();
  const n = parseScheduleSeason(season, ctx.calendarSeason ?? ctx.activeSeason);
  if (n === null) return withSocial({ title: 'Season not found', robots: { index: false, follow: true } });
  return withSocial({
    title: `${n} Formula 1 calendar`,
    description: `Every round of the ${n} Formula 1 World Championship: dates, circuits, sessions and race winners.`,
    alternates: { canonical: n === ctx.calendarSeason ? '/schedule' : `/schedule/${n}` },
  });
}

export default async function SeasonSchedulePage(props: { params: Promise<{ season: string }> }) {
  const { season } = await props.params;
  const ctx = await getSeasonContext();
  const newest = ctx.calendarSeason ?? ctx.activeSeason;
  const seasonNum = parseScheduleSeason(season, newest);
  if (seasonNum === null) notFound();

  const [read, winners, live] = await Promise.all([
    readPublicSport(() => jolpica.getSchedule(seasonNum, { ...SPORT_READ_OPTIONS, revalidate: 3600 })),
    getRoundWinners(seasonNum),
    getStandingsSeason(),
  ]);
  if (read.state === 'unavailable') {
    await outageConnection();
    return (
      <Section tone="carbon" className="min-h-[100svh]">
        {/* Fills the viewport like the loading skeleton it replaces: the footer never jumps up into view (CLS). */}
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Schedule', href: '/schedule' }, { label: String(seasonNum) }]} />
        <Heading level={1} className="mt-6">{seasonNum} calendar</Heading>
        <Unavailable className="mt-10 max-w-[60rem]" title={`${seasonNum} calendar unavailable`} action={{ label: 'Try again', href: `/schedule/${seasonNum}` }}>
          This calendar can’t be shown right now. Please check back in a few minutes.
        </Unavailable>
      </Section>
    );
  }
  const races = read.data.map(mapRace);
  const now = requestNow();
  const circuitFacts = await loadCircuitFacts(races, { now });
  const colourOf = makeColourOf(live.season === seasonNum ? await getTeamColours() : {});
  return (
    <SeasonCalendar
      season={seasonNum}
      currentSeason={ctx.calendarSeason ?? newest}
      newestSeason={Math.max(newest, seasonNum)}
      races={races}
      winners={winners.winners}
      winnersState={winners.state}
      now={now}
      circuitFacts={circuitFacts}
      teamColour={(id) => colourOf(id)}
    />
  );
}
