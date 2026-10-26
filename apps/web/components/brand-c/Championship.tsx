import type { BrandCData } from './data';
import { RailFocus } from './RailControls';
import { StudioCard } from './StudioCard';
import { TimingTower } from './TimingTower';
import { WrittenLine } from './WrittenLine';

/**
 * Drivers' championship: the story in one self-writing line (from the
 * published points), the top three lit in the studio, and the timing tower
 * turning its pages beside them.
 */
export function Championship({ data }: { data: BrandCData }) {
  const top = data.standings.slice(0, 3);
  const round = data.title?.round ?? null;
  return (
    <section aria-labelledby="bc-champ-title" className="relative border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-20 lg:py-28">
      <div className="ds-container">
        <p data-rv className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Drivers&apos; championship{round ? ` · after round ${round}` : ''}</p>
        {data.headline ? (
          <>
            <div data-rv><WrittenLine id="bc-champ-title" text={data.headline.text} className="bc-display mt-4 max-w-[18ch] text-[clamp(2.1rem,5.4vw,4.6rem)] [text-wrap:balance]" /></div>
            <p data-rv className="mt-5 max-w-[60ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">{data.headline.support}</p>
          </>
        ) : <h2 id="bc-champ-title" className="bc-display mt-4 text-[clamp(min(2rem,calc((100vw_-_32px)/11)),4.6vw,3.8rem)]">The championship</h2>}
        {top.length ? (
          <div className="mt-12 grid gap-6 lg:grid-cols-12">
            {/* Phones: the three cards are a swipeable rail; tablets and up: a row. */}
            <ol id="bc-champ-rail" className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:col-span-8 lg:h-full [&::-webkit-scrollbar]:hidden" aria-label="Top three">
              {top.map((d) => (
                <li data-rv key={d.slug} className="w-[78vw] max-w-[22rem] shrink-0 snap-center sm:w-auto sm:max-w-none">
                  <StudioCard d={d} leader={d.position === 1} />
                </li>
              ))}
            </ol>
            <RailFocus railId="bc-champ-rail" />
            <div data-rv className="lg:col-span-4">
              <TimingTower rows={data.standings.map((d) => ({ slug: d.slug, position: d.position, code: d.code, lastName: d.lastName, color: d.color, points: d.points }))} racePoints={data.lastRacePoints} lastRaceShort={data.lastRaceShort} round={round} />
            </div>
          </div>
        ) : <p className="mt-8 text-[color:var(--bc-titanium)]">The standings are unavailable right now. They return here on their own.</p>}
      </div>
    </section>
  );
}
