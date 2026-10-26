import '@/components/brand-c/brand-c.css';
import './results.css';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Breadcrumbs } from '@/components/ds';
import { ArchiveTimeline, type RibbonSeason } from './ArchiveTimeline';
import { CONSTRUCTORS_FROM } from './data';
import { DecadeRail } from './DecadeRail';
import { titleCounts } from './sheet';

export interface ArchiveSeason {
  year: number;
  rounds: number | null;
  champion: string | null;
  championTeam: string | null;
  constructor: string | null;
  current: boolean;
}

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/**
 * /results/archive, Carbon & Light: every season since 1950 as a lit
 * timeline (bar height = rounds), then the seasons by decade under a sticky
 * era rail, each decade opening with who won its titles. Every figure is
 * counted from the rows on this page.
 */
export function ArchiveView({ seasons, current, leader, teamLeader, missing }: {
  seasons: ArchiveSeason[];
  current: number;
  leader: string | null;
  teamLeader: string | null;
  missing: number;
}) {
  const years = seasons.map((s) => s.year);
  const decades = [...new Set(years.map((y) => Math.floor(y / 10) * 10))].sort((a, b) => b - a);
  const ribbon: RibbonSeason[] = seasons.map((s) => ({ year: s.year, rounds: s.rounds, champion: s.champion, constructor: s.constructor, current: s.current }));
  const completed = seasons.filter((s) => !s.current);
  const roundsRun = completed.every((s) => s.rounds != null) ? completed.reduce((sum, s) => sum + (s.rounds ?? 0), 0) : null;
  const champions = titleCounts(seasons);
  const mostTitles = champions[0]?.titles ?? 0;
  const record = champions.filter((c) => c.titles === mostTitles);
  const maxRounds = Math.max(1, ...seasons.map((s) => s.rounds ?? 0));
  const lastDone = completed.at(-1)?.year ?? null;

  const stats: Array<{ k: string; v: ReactNode; note: ReactNode }> = [
    { k: 'Seasons', v: years.length, note: `${years[0]} to ${years.at(-1)}` },
    ...(roundsRun != null && lastDone ? [{ k: 'Rounds', v: roundsRun.toLocaleString('en-GB'), note: `in the seasons from ${years[0]} to ${lastDone}` }] : []),
    ...(missing === 0 && champions.length ? [{ k: 'Champions', v: champions.length, note: 'different drivers’ champions' }] : []),
    ...(missing === 0 && record.length ? [{ k: 'Most titles', v: mostTitles, note: record.map((c) => c.name).join(' and ') }] : []),
  ];

  return (
    <div className="bc relative">
      <section aria-labelledby="archive-title" className="relative isolate overflow-hidden">
        <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
        <div aria-hidden className="bc-flood-static bc-in-strike absolute inset-0" style={d(80)} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
        <div className="ds-container relative pb-12 pt-6 md:pb-16 md:pt-10">
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Results', href: `/results/${current}/drivers` }, { label: 'Archive' }]} />
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8 md:mt-10 lg:grid-cols-12 lg:items-end">
            <div className="min-w-0 lg:col-span-8">
              <p className="bc-label bc-in-up flex items-center gap-3 text-[color:var(--bc-silver)]" style={d(40)}><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />The World Championship archive</p>
              <h1 id="archive-title" className="bc-display mt-5 text-[clamp(2.3rem,6.4vw,5.4rem)]">
                <span className="bc-mask"><span className="bc-in-rise" style={d(80)}>Every season</span></span>
                <span className="bc-mask"><span className="bc-in-rise text-[color:var(--bc-silver)]" style={d(160)}>since {years[0]}</span></span>
              </h1>
            </div>
            <p className="bc-in-up max-w-[44ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)] lg:col-span-4" style={d(240)}>
              {years.length} seasons of the Formula 1 World Championship, {years[0]} to {years.at(-1)}. Each one opens its calendar and both championship tables.
            </p>
          </div>
          <div className="mt-12 md:mt-16"><ArchiveTimeline seasons={ribbon} /></div>
        </div>
      </section>

      <section aria-label="The archive in numbers" className="border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)]">
        <dl className={cn('ds-container grid grid-cols-2', stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          {stats.map((s, i) => (
            <div key={s.k} className={cn('min-w-0 py-5 pr-4 lg:py-6', i > 0 && 'lg:border-l lg:border-[color:var(--bc-rule)] lg:pl-6', i % 2 === 1 && 'max-lg:border-l max-lg:border-[color:var(--bc-rule)] max-lg:pl-4', i >= 2 && 'max-lg:border-t max-lg:border-[color:var(--bc-rule)]')}>
              <dt className="bc-label text-[color:var(--bc-titanium)]">{s.k}</dt>
              <dd className="bc-mono mt-2 text-[clamp(1.6rem,2.6vw,2.2rem)] leading-none text-[color:var(--bc-white)]">{s.v}</dd>
              <dd className="mt-2 text-[0.875rem] leading-snug text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">{s.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="seasons-title" className="relative bg-[color:var(--bc-night)] pb-20 pt-14 md:pt-20">
        <div className="ds-container">
          <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Newest first</p>
          <h2 id="seasons-title" className="bc-display mt-4 text-[clamp(1.9rem,4vw,3.2rem)]">The seasons</h2>
          {missing > 0 && (
            <div role="note" className="mt-8 max-w-[60rem] rounded-[18px] bg-[color:var(--bc-carbon)] p-5 ring-1 ring-[color:var(--bc-rule)]">
              <p className="font-semibold">{missing} {missing === 1 ? 'champion' : 'champions'} unavailable</p>
              <p className="mt-1 text-[0.92rem] text-[color:var(--bc-silver)]">Those seasons still link to their standings. The champion appears here once it is confirmed.</p>
            </div>
          )}
        </div>
        <div className="mt-10"><DecadeRail decades={decades} /></div>
        <div className="ds-container">
          {decades.map((decade) => {
            const rows = seasons.filter((s) => Math.floor(s.year / 10) * 10 === decade).sort((a, b) => b.year - a.year);
            const top = titleCounts(rows).slice(0, 3);
            return (
              <section key={decade} id={`d${decade}`} aria-labelledby={`d${decade}-title`} className="grid scroll-mt-[calc(var(--shell-h)+4rem)] gap-6 border-b border-[color:var(--bc-rule)] py-12 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
                <header className="self-start md:sticky md:top-[calc(var(--nav-offset)+5.5rem)]">
                  <h3 id={`d${decade}-title`} className="bc-display text-[clamp(2.4rem,4.6vw,3.6rem)]">{decade}<span className="normal-case">s</span></h3>
                  <p className="mt-3 text-[0.88rem] text-[color:var(--bc-titanium)]"><span className="bc-mono text-[color:var(--bc-silver)]">{rows.length}</span> {rows.length === 1 ? 'season' : 'seasons'}</p>
                  {top.length > 0 && (
                    <ul className="mt-4 space-y-1.5" aria-label={`Most titles in the ${decade}s`}>
                      {top.map((c) => (
                        <li key={c.name} className="flex items-baseline gap-2 text-[0.88rem] text-[color:var(--bc-silver)]">
                          <span className="bc-mono w-7 shrink-0 text-[color:var(--bc-white)]">×{c.titles}</span>
                          <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </header>
                <ol className="min-w-0 overflow-hidden rounded-[18px] bg-[color:var(--bc-carbon)] ring-1 ring-[color:var(--bc-rule)]">
                  {rows.map((s) => <SeasonRow key={s.year} s={s} maxRounds={maxRounds} leader={leader} teamLeader={teamLeader} />)}
                </ol>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const LINK = 'inline-flex min-h-11 items-center rounded-full px-3.5 text-[0.85rem] font-semibold text-[color:var(--bc-white)] ring-1 ring-[color:var(--bc-rule-strong)] transition-colors hover:bg-white hover:text-[color:var(--bc-night)]';

function SeasonRow({ s, maxRounds, leader, teamLeader }: { s: ArchiveSeason; maxRounds: number; leader: string | null; teamLeader: string | null }) {
  return (
    <li className={cn('relative grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-b border-[color:var(--bc-rule)] px-4 py-5 last:border-b-0 sm:px-6 xl:grid-cols-[5.5rem_minmax(0,1.25fr)_minmax(0,1fr)_8.5rem_auto] xl:items-center', s.current && 'bg-white/[0.035]')}>
      {s.current && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[color:var(--bc-red)]" />}
      <Link prefetch={false} href={`/results/${s.year}/drivers`} className="bc-wide -mt-3 inline-flex min-h-11 items-center self-start text-[1.55rem] leading-none xl:mt-0 text-[color:var(--bc-white)] transition-colors hover:text-[color:var(--bc-red-text)] xl:self-center">
        {s.year}
        <span className="sr-only"> drivers&apos; standings</span>
      </Link>
      <div className="min-w-0">
        <p className="bc-label text-[color:var(--bc-titanium)] xl:sr-only">{s.current ? 'Season in progress' : 'Drivers’ champion'}</p>
        {s.champion ? (
          <p className="mt-1 xl:mt-0">
            <span className="block font-semibold text-[color:var(--bc-white)] [overflow-wrap:anywhere]">{s.champion}</span>
            {s.championTeam && <span className="block text-[0.82rem] text-[color:var(--bc-titanium)]">Drove for {s.championTeam}</span>}
          </p>
        ) : s.current ? (
          <p className="mt-1 xl:mt-0">
            <span className="hidden text-[0.74rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--bc-red-text)] xl:block">In progress</span>
            {leader ? <span className="block font-semibold text-[color:var(--bc-white)]">Leader: {leader}</span> : <span className="block text-[0.88rem] text-[color:var(--bc-silver)]">Champion not decided yet</span>}
          </p>
        ) : (
          <p className="mt-1 text-[0.88rem] text-[color:var(--bc-titanium)] xl:mt-0">Champion unavailable</p>
        )}
      </div>
      <p className="col-start-2 min-w-0 text-[0.88rem] text-[color:var(--bc-silver)] [overflow-wrap:anywhere] xl:col-start-auto">
        <span className="text-[color:var(--bc-titanium)] xl:sr-only">Constructors&apos; champion: </span>
        {s.year < CONSTRUCTORS_FROM
          ? <span className="text-[color:var(--bc-titanium)]">No constructors&apos; title until {CONSTRUCTORS_FROM}</span>
          : s.constructor ?? (s.current ? (teamLeader ? <>Leader: {teamLeader}</> : <span className="text-[color:var(--bc-titanium)]">Title still open</span>) : <span className="text-[color:var(--bc-titanium)]">Unavailable</span>)}
      </p>
      <p className="col-start-2 flex items-center gap-3 text-[0.82rem] text-[color:var(--bc-titanium)] xl:col-start-auto">
        {s.rounds != null ? (
          <>
            <span aria-hidden className="relative h-[4px] w-14 shrink-0 overflow-hidden rounded-full bg-white/[0.08]"><span className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--bc-silver)]" style={{ width: `${(s.rounds / maxRounds) * 100}%` }} /></span>
            <span className="whitespace-nowrap"><span className="bc-mono text-[color:var(--bc-white)]">{s.rounds}</span> rounds</span>
          </>
        ) : <span>Rounds unavailable</span>}
      </p>
      <nav aria-label={`${s.year} pages`} className="col-span-2 flex flex-wrap gap-2 xl:col-span-1 xl:justify-end">
        <Link prefetch={false} href={`/schedule/${s.year}`} className={LINK}>Calendar</Link>
        <Link prefetch={false} href={`/results/${s.year}/drivers`} className={LINK}>Drivers</Link>
        {s.year >= CONSTRUCTORS_FROM && <Link prefetch={false} href={`/results/${s.year}/teams`} className={LINK}>Constructors</Link>}
      </nav>
    </li>
  );
}
