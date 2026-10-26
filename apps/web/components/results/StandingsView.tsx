import '@/components/brand-c/brand-c.css';
import './results.css';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { jolpica, mapConstructorStanding, mapDriverStanding, standingPositionLabel } from '@apex/api-client/jolpica';
import { cn } from '@apex/ui';
import { Breadcrumbs, ButtonLink } from '@/components/ds';
import { AutoRefresh } from '@/components/brand-c/live';
import { makeColourOf } from '@/components/race/ResultsSheet';
import { SeasonPicker } from '@/components/schedule/SeasonPicker';
import { getCalendar, getGrid, getStandingsSeason, getTeamColours } from '@/lib/grid';
import { decodeEntities } from '@/lib/format';
import { readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { getSeasonContext } from '@/lib/season';
import { requestNow } from '@/components/schedule/data';
import { CONSTRUCTORS_FROM, loadSeasonSummary } from './data';
import { LeaderCard } from './LeaderCard';
import { fmtPoints, tableNote, titleMaths, type TitleMaths } from './sheet';
import { StandingsBoard, type BoardRow } from './StandingsBoard';
import { providerOutage } from '@/lib/provider-outage';
import { outageDuringBuild } from '@/lib/outage-connection';
import { constructorTableNote } from '@/lib/provider-notes';

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;
const pts = (n: number) => <><Num>{fmtPoints(n)}</Num> {n === 1 ? 'point' : 'points'}</>;

/**
 * /results/[season]/drivers and /teams, Carbon & Light: the season under
 * floodlights (the leader or champion lit in team colour, the title maths
 * from the official table and the published calendar), then the
 * championship board (season chart, replay scrubber, the timing sheet).
 * Headshots and team colours exist only for the live standings season.
 */
export async function StandingsView({ kind, season, newestSeason }: { kind: 'drivers' | 'teams'; season: number; newestSeason: number }) {
  const noun = kind === 'drivers' ? 'drivers' : 'constructors';
  const tabYears = Array.from({ length: 5 }, (_, i) => newestSeason - i).filter((y) => y >= 1950);
  const allYears = Array.from({ length: newestSeason - 1950 + 1 }, (_, i) => newestSeason - i);

  // The short states (no table, unavailable) replace the 20-row loading skeleton: the hero fills one
  // screen so the footer stays below the fold instead of jumping up into view (CLS, gate 2026-10-26).
  const shell = (label: ReactNode, body: ReactNode, aside?: ReactNode) => (
    <Hero kind={kind} season={season} newestSeason={newestSeason} tabYears={tabYears} allYears={allYears} label={label} aside={aside} colour={null} fill>
      {body}
    </Hero>
  );

  if (kind === 'teams' && season < CONSTRUCTORS_FROM) {
    return (
      <div className="bc relative">
        {shell(
          <>Constructors&apos; championship <Sep />{season}</>,
          <div className="mt-8 max-w-[56ch]">
            <p className="bc-wide text-[clamp(1.3rem,2.4vw,1.9rem)] leading-tight">No constructors&apos; championship in {season}</p>
            <p className="mt-3 text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">The constructors&apos; championship was first awarded in {CONSTRUCTORS_FROM}, so there is no table for {season}.</p>
            <ButtonLink href={`/results/${season}/drivers`} variant="secondary" className="mt-6">{season} drivers&apos; championship</ButtonLink>
          </div>,
        )}
      </div>
    );
  }

  const opts = { ...SPORT_READ_OPTIONS, revalidate: 300 };
  const [read, live, ctx] = await Promise.all([
    readPublicSport<{ round: number | null; standings: unknown[] }>(() => (kind === 'drivers' ? jolpica.getDriverStandingsSnapshot(season, opts) : jolpica.getConstructorStandingsSnapshot(season, opts))),
    getStandingsSeason(),
    getSeasonContext(),
  ]);
  // A season whose final round has run and is classified has a champion, not a leader (lib/season).
  const decided = season <= ctx.lastCompletedSeason;
  const champLabel = <>{kind === 'drivers' ? 'Drivers' : 'Constructors'}&apos; championship <Sep />{season}</>;
  // Outage policy: a season table is a detail page. Throw, so an ISR revalidation during an outage
  // keeps serving the last good table (stale-on-error) and a first visit gets the designed route error
  // screen (app/error.tsx, outage copy) instead of caching an empty table over a good one.
  if (read.state === 'unavailable') {
    // During `next build` a throw would fail the whole deploy (F-01): the honest state is
    // prerendered with a one-minute revalidate instead, and ISR replaces it with the table.
    if (await outageDuringBuild()) {
      return (
        <div className="bc relative">
          {shell(champLabel,
            <div className="mt-8 max-w-[56ch]">
              <p className="bc-wide text-[clamp(1.3rem,2.4vw,1.9rem)] leading-tight">The {season} table is temporarily unavailable</p>
              <p className="mt-3 text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">The standings could not be loaded just now. This page refreshes itself within a few minutes.</p>
              <ButtonLink href={`/schedule/${season}`} variant="secondary" className="mt-6">{season} calendar</ButtonLink>
            </div>,
          )}
          <AutoRefresh everyMs={60_000} />
        </div>
      );
    }
    providerOutage(`${season} ${noun} standings`);
  }

  const isLive = live.season === season;
  const [grid, colours] = isLive ? await Promise.all([getGrid().catch(() => []), getTeamColours().catch(() => ({}))]) : [[], {}];
  const colourOf = makeColourOf(colours);
  const bySlug = new Map(grid.map((g) => [g.slug, g]));

  let rows: BoardRow[];
  let subLabel = kind === 'drivers' ? 'Team' : 'Drivers';
  if (kind === 'drivers') {
    rows = (read.data.standings as Parameters<typeof mapDriverStanding>[0][]).map((entry) => {
      const s = mapDriverStanding(entry);
      const g = bySlug.get(s.driver.slug);
      // Every team the driver scored for that season, not only the first (D2-DATA-TRUTH-6: Lawson 2025, Red Bull then Racing Bulls).
      const teams = (entry.Constructors ?? []).map((c) => c.name).filter(Boolean);
      return {
        id: s.driver.slug, position: s.position, positionLabel: standingPositionLabel(s), first: s.driver.firstName, last: s.driver.lastName,
        href: `/drivers/${s.driver.slug}`, sub: teams.length > 1 ? teams.join(' / ') : s.constructorName || 'Team not published', subHref: teams.length <= 1 && s.constructorSlug ? `/teams/${s.constructorSlug}` : null,
        colour: colourOf(s.constructorSlug), headshot: g?.headshot ?? null, code: s.driver.code ?? null, points: s.points, wins: s.wins,
      };
    });
  } else {
    rows = (read.data.standings as Parameters<typeof mapConstructorStanding>[0][]).map(mapConstructorStanding).map((s) => {
      // Everyone who raced for the team this season (d.teams, R3-DATA-1: Lawson's 3 Red Bull races in 2026), current line-up first.
      const pair = grid
        .filter((g) => g.teamSlug === s.constructor.slug || g.teams.some((t) => t.slug === s.constructor.slug))
        .sort((a, b) => Number(b.teamSlug === s.constructor.slug) - Number(a.teamSlug === s.constructor.slug))
        .map((g) => g.lastName);
      if (!pair.length) subLabel = 'Nationality';
      return {
        id: s.constructor.slug, position: s.position, positionLabel: standingPositionLabel(s), first: '', last: s.constructor.name,
        href: `/teams/${s.constructor.slug}`, sub: pair.length ? pair.join(', ') : s.constructor.nationality, subHref: null,
        colour: colourOf(s.constructor.slug), headshot: null, code: null, points: s.points, wins: s.wins,
      };
    });
  }

  if (rows.length === 0) {
    return (
      <div className="bc relative">
        {shell(champLabel,
          <div className="mt-8 max-w-[56ch]">
            <p className="bc-wide text-[clamp(1.3rem,2.4vw,1.9rem)] leading-tight">No {season} table yet</p>
            <p className="mt-3 text-[1rem] leading-relaxed text-[color:var(--bc-silver)]">There is no {season} {noun}&apos; table yet. It appears here on its own after the first classified round.</p>
            <ButtonLink href={`/schedule/${season}`} variant="secondary" className="mt-6">{season} calendar</ButtonLink>
          </div>,
        )}
        {isLive && <AutoRefresh everyMs={300_000} />}
      </div>
    );
  }

  const tableRound = read.data.round ?? null;
  const [summary, calendar] = await Promise.all([
    loadSeasonSummary(season, kind, rows.map((r) => ({ id: r.id, points: r.points })), tableRound),
    isLive ? getCalendar() : Promise.resolve(null),
  ]);
  const leader = rows[0]!;
  const second = rows[1];
  const ownCalendar = calendar && calendar.season === season && calendar.races.length ? calendar : null;
  const totalRounds = ownCalendar ? ownCalendar.races.length : null;
  // Rounds the table actually contains. When the running totals reproduce the official table, the
  // progression's last round is proven; Jolpica can file the table under a newer round before that
  // round's classification exists (2026: listed under round 18 while round 18 had no results yet).
  const provenRound = summary.progression?.rounds.at(-1)?.round ?? null;
  const countedRound = provenRound ?? tableRound;
  const filedAhead = provenRound != null && tableRound != null && tableRound > provenRound;
  const nowMs = requestNow();
  const toRun = isLive && ownCalendar ? ownCalendar.races.filter((r) => Date.parse(r.raceStartIso) > nowMs).length : null;
  const awaiting = isLive && ownCalendar && countedRound != null
    ? ownCalendar.races.filter((r) => r.round > countedRound && Date.parse(r.raceStartIso) + 3 * 3_600_000 <= nowMs)
    : [];
  const maths: TitleMaths | null = isLive && !decided && ownCalendar && countedRound != null
    ? titleMaths(kind, rows.filter((r) => r.position != null).map((r) => ({ id: r.id, points: r.points })), ownCalendar.races.map((r) => ({ round: r.round, sprint: r.sessions.some((s) => s.kind === 'S') })), countedRound)
    : null;
  const nextRace = ownCalendar?.races.find((r) => Date.parse(r.raceStartIso) > nowMs) ?? null;
  const name = (r: BoardRow) => (kind === 'drivers' ? r.last : r.last);
  const unit = kind === 'drivers' ? 'drivers' : 'teams';

  let story: ReactNode = null;
  if (decided && second) {
    story = <>{leader.first ? `${leader.first} ` : ''}{leader.last} took the {season} title by {pts(leader.points - second.points)} from {name(second)}{leader.wins > 0 ? <>, with <Num>{leader.wins}</Num> {leader.wins === 1 ? 'win' : 'wins'}</> : null}.</>;
  } else if (maths && second) {
    story = maths.clinched
      ? <>{name(leader)} has the {season} title: {pts(maths.gap)} clear with only {pts(maths.pointsLeft)} left to win.</>
      : maths.roundsLeft === 0
        ? <>{name(leader)} leads {name(second)} by {pts(maths.gap)}. Every round has run; the title is settled when the last classification is confirmed.</>
        : <>{name(leader)} leads {name(second)} by {pts(maths.gap)} with {pts(maths.pointsLeft)} still to win over <Num>{maths.roundsLeft}</Num> {maths.roundsLeft === 1 ? 'round' : 'rounds'}. {maths.alive.length === 0 ? <>No one else can catch {name(leader)} on points.</> : <><Num>{maths.alive.length + 1}</Num> {unit} can still take the title.</>}</>;
  } else if (second) {
    story = <>{name(leader)} leads {name(second)} by {pts(leader.points - second.points)}{countedRound != null ? <> after round <Num>{countedRound}</Num></> : null}.</>;
  }

  const notes: string[] = [];
  if (toRun != null && toRun > 0) notes.push(`Provisional: ${toRun} ${toRun === 1 ? 'round' : 'rounds'} still to run.`);
  if (awaiting.length > 0) notes.push(`The ${awaiting.map((r) => decodeEntities(r.name)).join(' and ')} has run; its points join the table once the official classification is confirmed.`);
  else if (filedAhead) notes.push(`The official table is labelled round ${tableRound}; its points cover rounds 1 to ${provenRound}.`);

  const stats: Array<{ k: string; v: ReactNode; note?: ReactNode }> = [
    { k: decided ? 'Champion' : 'Leader', v: fmtPoints(leader.points), note: <>points · {leader.last}</> },
    ...(second ? [{ k: decided ? 'Margin' : 'Gap to P2', v: fmtPoints(leader.points - second.points), note: <>points to {second.last}</> }] : []),
    { k: 'Rounds', v: <>{countedRound ?? '–'}{totalRounds ? <span className="text-[color:var(--bc-titanium)]"> / {totalRounds}</span> : null}</>, note: totalRounds ? 'counted' : decided ? 'in the season' : 'counted' },
    ...(summary.winners != null ? [{ k: 'Winners', v: String(summary.winners), note: kind === 'drivers' ? 'different race winners' : 'winning constructors' }] : []),
    ...(maths && !maths.clinched && maths.roundsLeft > 0 ? [{ k: 'Still to win', v: fmtPoints(maths.pointsLeft), note: <>points{nextRace ? <> · next: {decodeEntities(nextRace.name).replace(/ Grand Prix$/, '')}</> : null}</> }] : []),
  ];

  return (
    <div className="bc relative">
      {/* The live table re-reads itself: every five minutes and a few hours after the next race starts. */}
      {isLive && !decided && <AutoRefresh everyMs={300_000} watch={nextRace ? [new Date(Date.parse(nextRace.raceStartIso) + 3 * 3_600_000).toISOString()] : []} />}
      <Hero
        kind={kind}
        season={season}
        newestSeason={newestSeason}
        tabYears={tabYears}
        allYears={allYears}
        colour={leader.colour}
        label={<>{champLabel}<Sep />{decided ? 'Final standings' : countedRound != null ? <>After round {countedRound}{totalRounds ? ` of ${totalRounds}` : ''}</> : 'Latest standings'}</>}
        aside={<LeaderCard row={leader} kind={kind} decided={decided} season={season} portrait={isLive && kind === 'drivers'} />}
      >
        {story && <p className="bc-in-up mt-6 max-w-[54ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)] md:text-[1.12rem]" style={d(240)}>{story}</p>}
        {notes.length > 0 && <p className="mt-3 max-w-[64ch] text-[0.88rem] leading-relaxed text-[color:var(--bc-titanium)]">{notes.join(' ')}</p>}
      </Hero>

      <section aria-label={`${season} at a glance`} className="relative border-y border-[color:var(--bc-rule)] bg-[color:var(--bc-night)]">
        <dl className={cn('ds-container grid grid-cols-2 sm:grid-cols-3', stats.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4')}>
          {stats.map((s, i) => (
            <div key={s.k} className={cn('min-w-0 py-5 pr-4 lg:py-6', i > 0 && 'lg:border-l lg:border-[color:var(--bc-rule)] lg:pl-6', i % 2 === 1 && 'max-sm:border-l max-sm:border-[color:var(--bc-rule)] max-sm:pl-4', i >= 2 && 'max-sm:border-t max-sm:border-[color:var(--bc-rule)]', i === stats.length - 1 && i % 2 === 0 && 'max-sm:col-span-2')}>
              <dt className="bc-label text-[color:var(--bc-titanium)]">{s.k}</dt>
              <dd className="bc-mono mt-2 text-[clamp(1.6rem,2.6vw,2.2rem)] leading-none text-[color:var(--bc-white)]">{s.v}</dd>
              {s.note && <dd className="mt-2 text-[0.875rem] leading-snug text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">{s.note}</dd>}
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Championship board" className="relative bg-[color:var(--bc-night)] py-12 md:py-16 lg:py-20">
        <div className="ds-container">
          <StandingsBoard
            kind={kind}
            season={season}
            rows={rows}
            progression={summary.progression}
            progressionNote={summary.progressionNote}
            showHeadshots={isLive && kind === 'drivers'}
            caption={`${season} ${noun}' championship standings`}
            tableRound={countedRound}
            decided={decided}
            alive={maths && !maths.clinched ? [leader.id, ...maths.alive] : null}
            // The results page's own 2018 note wins; the shared provider note covers any other noted season.
            tableNote={tableNote(kind, season) ?? (kind === 'teams' ? constructorTableNote(season)?.table ?? null : null)}
            subLabel={subLabel}
          />
          <div className="mt-10 flex flex-col gap-6 border-t border-[color:var(--bc-rule)] pt-8 md:flex-row md:items-center md:justify-between">
            <ul className="flex flex-wrap gap-x-8 gap-y-1">
              <li><FootLink href={`/schedule/${season}`}>{season} calendar</FootLink></li>
              <li><FootLink href={`/results/${season}/${kind === 'drivers' ? 'teams' : 'drivers'}`}>{season} {kind === 'drivers' ? 'constructors' : 'drivers'}&apos; table</FootLink></li>
              <li><FootLink href="/results/archive">Every season since 1950</FootLink></li>
            </ul>
            {countedRound != null && <p className="text-[0.82rem] text-[color:var(--bc-titanium)]">Standings after round {countedRound}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}

function Sep() {
  return <span aria-hidden className="mx-3 text-[color:var(--bc-graphite)]">/</span>;
}

function Num({ children }: { children: ReactNode }) {
  return <span className="bc-mono whitespace-nowrap text-[color:var(--bc-white)]">{children}</span>;
}

function FootLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex min-h-11 items-center gap-2 text-[0.95rem] font-semibold text-[color:var(--bc-white)]">
      <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]">{children}</span>
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 text-[color:var(--bc-red-text)] transition-transform duration-300 group-hover:translate-x-0.5"><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Link>
  );
}

/** The season under floodlights: label, title, championship and season switches, and the lit leader. */
function Hero({ kind, season, newestSeason, tabYears, allYears, label, aside, colour, fill = false, children }: {
  kind: 'drivers' | 'teams';
  season: number;
  newestSeason: number;
  tabYears: number[];
  allYears: number[];
  label: ReactNode;
  aside?: ReactNode;
  colour: string | null;
  /** At least one screen tall (short states only). */
  fill?: boolean;
  children: ReactNode;
}) {
  const pill = 'relative inline-flex min-h-11 items-center px-5 text-[0.92rem] font-semibold transition-colors';
  const prev = season > 1950 ? season - 1 : null;
  const next = season < newestSeason ? season + 1 : null;
  const arrow = 'grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-[color:var(--bc-rule-strong)] transition-colors hover:bg-white hover:text-[color:var(--bc-night)]';
  return (
    <section aria-labelledby="standings-title" className={cn('relative isolate overflow-hidden', fill && 'min-h-[100svh]')}>
      <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
      <div aria-hidden className="bc-flood-static bc-in-strike absolute inset-0" style={d(80)} />
      {colour && <div aria-hidden className="bc-field absolute -right-[20%] top-[-10%] h-[90%] w-[80%] rounded-full opacity-40 lg:right-[-8%] lg:w-[55%]" style={{ '--team': colour } as CSSProperties} />}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />

      <div className="ds-container relative pb-12 pt-6 md:pb-16 md:pt-10">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Results', href: '/results/archive' }, { label: String(season) }, { label: kind === 'drivers' ? 'Drivers' : 'Constructors' }]} />
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-10 md:mt-10 lg:grid-cols-12 lg:items-end lg:gap-8">
          <div className="min-w-0 lg:col-span-7">
            <p className="bc-label bc-in-up flex flex-wrap items-center gap-y-1 text-[color:var(--bc-silver)]" style={d(40)}>
              <span aria-hidden className="mr-3 h-[2px] w-8 bg-[color:var(--bc-red)]" />{label}
            </p>
            <h1 id="standings-title" className="bc-display mt-5 text-[clamp(2.1rem,5.6vw,4.6rem)]">
              <span className="bc-mask"><span className="bc-in-rise" style={d(80)}>{season}</span></span>
              <span className="bc-mask"><span className="bc-in-rise text-[0.62em] text-[color:var(--bc-silver)]" style={d(160)}>{kind === 'drivers' ? 'Drivers’' : 'Constructors’'} championship</span></span>
            </h1>
            {children}
            <nav aria-label="Championship" className="mt-8">
              <ul className="inline-flex rounded-full p-1 ring-1 ring-[color:var(--bc-rule-strong)]">
                {(['drivers', 'teams'] as const).map((k) => (
                  <li key={k}>
                    <Link href={`/results/${season}/${k}`} aria-current={k === kind ? 'page' : undefined} className={cn(pill, 'rounded-full', k === kind ? 'bg-[color:var(--bc-white)] text-[color:var(--bc-night)]' : 'text-[color:var(--bc-silver)] hover:text-white')}>
                      {k === 'drivers' ? 'Drivers' : 'Constructors'}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          {aside && <div className="min-w-0 lg:col-span-5">{aside}</div>}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-[color:var(--bc-rule)] pt-6 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Season" className="flex min-w-0 items-center gap-3">
            {prev ? <Link href={`/results/${prev}/${kind}`} className={arrow} aria-label={`${prev} season`}><Chevron dir={-1} /></Link> : <span aria-hidden className={cn(arrow, 'opacity-30')}><Chevron dir={-1} /></span>}
            <ul className="flex min-w-0 flex-wrap items-center gap-x-1">
              {[...new Set([...tabYears, season])].sort((a, b) => b - a).map((y, i) => (
                <li key={y} className={cn(i >= 3 && y !== season && 'max-sm:hidden')}>
                  <Link href={`/results/${y}/${kind}`} aria-current={y === season ? 'page' : undefined} className={cn('bc-mono relative inline-flex min-h-11 items-center px-2.5 text-[0.95rem] transition-colors', y === season ? 'text-white after:absolute after:inset-x-2.5 after:bottom-1.5 after:h-[2px] after:bg-[color:var(--bc-red)]' : 'text-[color:var(--bc-titanium)] hover:text-white')}>{y}</Link>
                </li>
              ))}
            </ul>
            {next ? <Link href={`/results/${next}/${kind}`} className={arrow} aria-label={`${next} season`}><Chevron dir={1} /></Link> : <span aria-hidden className={cn(arrow, 'opacity-30')}><Chevron dir={1} /></span>}
          </nav>
          <SeasonPicker seasons={allYears} current={season} hrefFor={`/results/{season}/${kind}`} />
        </div>
      </div>
    </section>
  );
}

function Chevron({ dir }: { dir: 1 | -1 }) {
  return <svg aria-hidden viewBox="0 0 16 16" className="size-4"><path d={dir < 0 ? 'M10 3L5 8l5 5' : 'M6 3l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
