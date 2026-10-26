import type { BrandCData } from './data';
import type { HeroSlide } from './news-hero';
import { AutoRefresh } from './live';
import { NewsDesk } from './NewsDesk';
import { StateBar } from './Hero';

/**
 * Homepage hero when the news wire has at least three real Formula 1 stories
 * with pictures: the rotating news desk, then the same three answers the
 * race hero carries (what's next, why it matters, time at the circuit).
 * The page re-reads its data every five minutes and when a session starts,
 * so the desk follows the wire. With fewer stories the page keeps <Hero />.
 */
export function NewsHero({ slides, data }: { slides: HeroSlide[]; data: BrandCData }) {
  const watch = [data.next?.session?.iso, data.next?.raceIso].filter((x): x is string => Boolean(x));
  return (
    <div data-hero="news-desk" className="relative isolate flex flex-col overflow-hidden bg-[color:var(--bc-night)]">
      <AutoRefresh everyMs={300_000} watch={watch} />
      <NewsDesk slides={slides} />
      <StateBar data={data} />
    </div>
  );
}
