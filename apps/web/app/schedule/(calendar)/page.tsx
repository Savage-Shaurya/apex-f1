import type { Metadata } from 'next';
import { Breadcrumbs, Heading, Section, Unavailable } from '@/components/ds';
import { SeasonCalendar } from '@/components/schedule/SeasonCalendar';
import { getRoundWinners, requestNow } from '@/components/schedule/data';
import { makeColourOf } from '@/components/race/ResultsSheet';
import { loadCircuitFacts } from '@/lib/circuits/facts';
import { getCalendar, getStandingsSeason, getTeamColours } from '@/lib/grid';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

// Session statuses in the next-race band are recomputed in the browser; the page itself refreshes every 15 minutes.
// The calendar marks the next race and each weekend's state from the real clock.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const calendar = await getCalendar();
  if (calendar.state === 'unavailable' || calendar.races.length === 0) {
    return withSocial({ title: 'Formula 1 calendar', description: 'The Formula 1 race calendar: every round, session times, circuits and winners.', alternates: { canonical: '/schedule' } });
  }
  const n = calendar.races.length;
  return withSocial({
    title: `${calendar.season} Formula 1 calendar: all ${n} rounds`,
    description: `Every round of the ${calendar.season} Formula 1 season, from the ${calendar.races[0]!.name} to the ${calendar.races[n - 1]!.name}: dates, session times in your time zone, circuits and winners.`,
    alternates: { canonical: '/schedule' },
  });
}

export default async function SchedulePage() {
  // The calendar rolls forward on its own once a season has no race left (lib/public-sport).
  const calendar = await getCalendar();
  if (calendar.state === 'unavailable') {
    await outageConnection();
    return (
      <Section tone="carbon" className="min-h-[100svh]">
        {/* Fills the viewport like the loading skeleton it replaces: the footer never jumps up into view (CLS). */}
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Schedule' }]} />
        <Heading level={1} className="mt-6">Formula 1 calendar</Heading>
        <Unavailable className="mt-10 max-w-[60rem]" title="Calendar unavailable" action={{ label: 'Results archive', href: '/results/archive' }}>
          The calendar can’t be shown right now. Please check back in a few minutes.
        </Unavailable>
      </Section>
    );
  }
  const { season, races } = calendar;
  const now = requestNow();
  const [winners, circuitFacts, live] = await Promise.all([getRoundWinners(season), loadCircuitFacts(races, { now }), getStandingsSeason()]);
  const colourOf = makeColourOf(live.season === season ? await getTeamColours() : {});
  return (
    <SeasonCalendar
      season={season}
      currentSeason={season}
      newestSeason={season}
      races={races}
      winners={winners.winners}
      winnersState={winners.state}
      now={now}
      circuitFacts={circuitFacts}
      teamColour={(id) => colourOf(id)}
    />
  );
}
