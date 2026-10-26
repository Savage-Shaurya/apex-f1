import Link from 'next/link';
import { cn } from '@apex/ui';
import { circuitPath, getCircuit } from '@/lib/circuits';
import type { BrandCData, SeasonTile } from './data';
import { Countdown } from './live';
import { RailControls } from './RailControls';

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Outline({ id, className }: { id: string; className?: string }) {
  const c = getCircuit(id);
  if (!c) return null;
  const pad = Math.max(c.width, c.height) * 0.05;
  return (
    <svg aria-hidden viewBox={`${-pad} ${-pad} ${c.width + pad * 2} ${c.height + pad * 2}`} className={className} fill="none">
      <path d={circuitPath(c)} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tile({ t }: { t: SeasonTile }) {
  const round = `R${String(t.round).padStart(2, '0')}`;
  const date = Number.isFinite(Date.parse(t.raceIso)) ? day.format(Date.parse(t.raceIso)) : '';
  const base = 'group relative flex aspect-[3/4] w-[min(15rem,62vw)] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[18px] p-4 ring-1 transition-[box-shadow] duration-500';
  return (
    <li data-current={t.state === 'next' || undefined} className="shrink-0">
      <Link
        href={t.href}
        className={cn(base,
          t.state === 'won' && 'bg-[color:var(--bc-carbon)] ring-white/10 hover:shadow-[0_24px_60px_-30px_var(--team)]',
          t.state === 'next' && 'bg-[color:var(--bc-carbon)] ring-[color:var(--bc-red)]',
          (t.state === 'upcoming' || t.state === 'awaiting') && 'bg-transparent ring-white/[0.08]')}
        style={t.winner ? ({ '--team': t.winner.color } as React.CSSProperties) : undefined}
      >
        {t.state === 'won' && <span aria-hidden className="bc-field absolute -right-1/4 -top-1/4 h-3/4 w-[150%] rounded-full opacity-60" />}
        {t.state === 'next' && <span aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgb(225_6_0/0.22),transparent_70%)]" />}
        <span className="bc-label relative flex justify-between text-[0.66rem] text-[color:var(--bc-silver)]">
          <span>{round}</span><span>{t.state === 'next' ? 'Next' : date}</span>
        </span>
        <Outline id={t.circuitId} className={cn('relative mx-auto h-[38%] w-[78%]', t.state === 'won' ? 'text-white/70' : t.state === 'next' ? 'text-white' : 'text-white/25')} />
        <span className="relative block">
          <span className="bc-wide block text-[1.15rem] leading-tight text-white [overflow-wrap:anywhere]">{t.place}</span>
          <span className="mt-2 block border-t border-white/15 pt-2 text-[0.82rem] leading-snug">
            {t.state === 'won' && t.winner ? (
              <span className="flex items-center gap-2"><span aria-hidden className="h-3.5 w-[3px] rounded-full" style={{ background: t.winner.color }} /><span className="text-[color:var(--bc-silver)]">Won by</span> <span className="font-semibold text-white">{t.winner.name}</span></span>
            ) : t.state === 'next' ? (
              <span className="flex flex-wrap items-baseline gap-x-2"><span className="text-[color:var(--bc-silver)]">Lights out in</span><Countdown iso={t.raceIso} size="s" rolling={false} className="text-[0.82rem]" /></span>
            ) : t.state === 'awaiting' ? (
              <span className="text-[color:var(--bc-titanium)]">Result being confirmed</span>
            ) : (
              <span className="text-[color:var(--bc-titanium)]">{date}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The season as a rail of posters (grafted from direction B): one tile per
 * round, each turning from upcoming to next to its winner as results are
 * published. Native horizontal scroll with snap; buttons for mouse users.
 */
export function SeasonRail({ data }: { data: BrandCData }) {
  if (!data.tiles.length) return null;
  const done = data.tiles.filter((t) => t.state === 'won').length;
  return (
    <section aria-labelledby="bc-season-title" className="relative border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-20 lg:py-24">
      <div className="ds-container flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />The {data.season} season · {done} of {data.tiles.length} run</p>
          <h2 id="bc-season-title" className="bc-display mt-4 text-[clamp(2rem,4.6vw,3.8rem)]">Every round</h2>
        </div>
        <RailControls railId="bc-season-rail" />
      </div>
      <ol id="bc-season-rail" aria-label={`${data.season} rounds`} className="ds-container mt-10 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 [scroll-padding-inline:var(--page-margin)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {data.tiles.map((t) => <Tile key={t.round} t={t} />)}
      </ol>
    </section>
  );
}
