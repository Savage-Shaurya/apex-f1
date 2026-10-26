import type { JolpicaPitStopEntry, UiResult } from '@apex/api-client/jolpica';
import { jolpica } from '@apex/api-client/jolpica';
import { Stat, StatGroup, Text, Unavailable } from '@/components/ds';
import { SectionHead } from './SectionHead';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { buildLapStory, lapStoryFacts, placesFromGrid } from './lap-story';
import { LapChart } from './LapChart';

/** Jolpica F1 publishes lap-by-lap timings from the 1996 season. */
export const LAPS_FROM = 1996;

/**
 * "Lap by lap": the race's running order from Jolpica lap timings, streamed
 * in its own Suspense boundary (the laps arrive in pages of 100 rows). A
 * finished race only; the read is cached for a day. When the provider has no
 * rows the section says so plainly; when it fails, it says that instead.
 */
export async function LapStory({ season, round, results, pitStops }: { season: number; round: number; results: UiResult[]; pitStops: JolpicaPitStopEntry[] }) {
  const read = await readPublicSport(() => jolpica.getLaps(season, round, { ...SPORT_READ_OPTIONS, deadlineMs: 45_000, revalidate: 86_400 }));
  const heading = <SectionHead id="laps-title" label="The race" title="Lap by lap" />;
  if (read.state === 'unavailable') {
    return (
      <div>
        {heading}
        <Unavailable compact className="mt-8 max-w-[60rem]" title="Lap chart unavailable">
          The lap chart can’t be shown right now. The classification above is complete. Please check back in a few minutes.
        </Unavailable>
      </div>
    );
  }
  const story = buildLapStory(read.data, results.map((r) => ({ driver: r.driver, positionText: r.positionText, grid: r.grid })), pitStops);
  if (!story) {
    return (
      <div>
        {heading}
        <Text size="body" tone="muted" className="mt-6" measure>Lap-by-lap timings for this race are not available yet.</Text>
      </div>
    );
  }
  const facts = lapStoryFacts(story);
  const climbs = story.drivers
    .filter((d) => /^\d+$/.test(d.positionText))
    .map((d) => ({ d, gain: placesFromGrid(d, story.field) }))
    .filter((x): x is { d: typeof x.d; gain: number } => x.gain != null)
    .sort((a, b) => b.gain - a.gain);
  const climber = climbs[0] && climbs[0].gain > 0 ? climbs[0] : null;
  const leaderNames = facts.leaders.map((id) => story.drivers.find((d) => d.id === id)!.last);

  return (
    <div>
      {heading}
      <StatGroup className="mt-8 md:mt-10">
        <Stat label="Laps" value={story.laps} />
        <Stat label="Lead changes" value={facts.leadChanges} note={leaderNames.length ? `Led by ${leaderNames.join(', ')}` : undefined} />
        {climber && <Stat label="Biggest climb" value={`+${climber.gain}`} unit={climber.gain === 1 ? 'place' : 'places'} note={`${climber.d.last}, from ${climber.d.grid === 0 ? 'the pit lane' : `P${climber.d.grid}`} to P${climber.d.positionText}`} />}
      </StatGroup>
      <div className="mt-10 md:mt-12">
        <LapChart story={story} initialFollow={climber && climber.d.order > 3 ? climber.d.id : undefined} />
      </div>
    </div>
  );
}
