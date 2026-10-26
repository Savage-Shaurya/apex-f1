import Link from 'next/link';
import type { UiRace } from '@apex/api-client/jolpica';
import { Breadcrumbs, TabLinks } from '@/components/ds';
import '@/components/brand-c/brand-c.css';
import { CircuitStreak } from '@/components/brand-c/CircuitStreak';
import { AutoRefresh } from '@/components/brand-c/live';
import { ClockName } from '@/components/race/SessionClock';
import { chronological, weekendDates } from '@/components/race/weekend';
import { circuitPath, getCircuit } from '@/lib/circuits';
import { circuitTimeZone } from '@/components/race/circuit-timezones';
import { factsForRound } from '@/components/race/round-layouts';
import { calendarFocusIndex } from '@/lib/calendar-window';
import { circuitFactsKey, formatLapLength, type CircuitFacts } from '@/lib/circuits/facts';
import type { RoundWinner } from './data';
import { NextRaceSessions } from './NextRaceSessions';
import { SeasonPicker } from './SeasonPicker';
import { SeasonPosters, type PosterRound } from './SeasonPosters';

const isSprint = (r: UiRace) => r.sessions.some((s) => s.kind === 'S');
/** Circuit-local calendar days (the event's own dates); "(UTC)" only when the circuit's zone is unknown. */
const zoneOf = (r: UiRace) => circuitTimeZone(r.circuitId, r.country);
const weekendRange = (r: UiRace) => {
  const zone = zoneOf(r);
  const text = weekendDates(chronological(r.sessions)[0]?.iso ?? r.raceStartIso, r.raceStartIso, zone);
  return zone || /^\d{4}-\d{2}-\d{2}$/.test(r.raceStartIso) ? text : `${text} (UTC)`;
};
const routeOf = (r: UiRace) => `/schedule/${r.season}/${r.routeSlug ?? r.slug}`;
const MONTH = (r: UiRace) => new Date(r.raceStartIso).toLocaleString('en-GB', { month: 'long', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(r.raceStartIso) ? 'UTC' : zoneOf(r) ?? 'UTC' });

export interface SeasonCalendarProps {
  season: number;
  /** Season the calendar service is on now (lib/season calendarSeason). */
  currentSeason: number;
  /** Newest season a reader can open (current calendar season). */
  newestSeason: number;
  races: UiRace[];
  winners: Map<number, RoundWinner>;
  winnersState: 'available' | 'unavailable';
  now: number;
  circuitFacts: ReadonlyMap<string, CircuitFacts>;
  /** Live team colours, current season only (lib/grid). */
  teamColour: (constructorId: string) => string | null;
}

/**
 * The season calendar, Carbon & Light: a title band with the season's
 * progress, the next race lit (its circuit lapped by light, every session in
 * the reader's time, counting down), then every round as a poster that moves
 * from upcoming to next to its winner on its own. Winners come from the
 * published results; one that could not be loaded says so instead of hiding.
 */
export function SeasonCalendar(p: SeasonCalendarProps) {
  const { races, now } = p;
  const focusIdx = calendarFocusIndex(races, now);
  const focus = focusIdx >= 0 ? races[focusIdx]! : null;
  const run = races.filter((r) => Date.parse(r.raceStartIso) <= now).length;
  const sprints = races.filter(isSprint).length;
  const countries = new Set(races.map((r) => r.country)).size;
  const timed = races.some((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.raceStartIso));
  const complete = races.length > 0 && run === races.length;
  const hrefFor = (y: number) => (y === p.currentSeason ? '/schedule' : `/schedule/${y}`);
  const tabYears = Array.from({ length: 5 }, (_, i) => p.newestSeason - i).filter((y) => y >= 1950);
  if (!tabYears.includes(p.season)) tabYears.push(p.season);
  const allYears = Array.from({ length: p.newestSeason - 1950 + 1 }, (_, i) => p.newestSeason - i);

  const rounds: PosterRound[] = races.map((r) => {
    const facts = factsForRound(r, p.circuitFacts.get(circuitFactsKey(r)));
    const c = facts?.showOutline ? getCircuit(r.circuitId) : null;
    const w = p.winners.get(r.round);
    const first = chronological(r.sessions)[0]?.iso ?? r.raceStartIso;
    return {
      round: r.round, name: r.name, place: r.city || r.circuitName, country: r.country, href: routeOf(r),
      dates: weekendRange(r), sprint: isSprint(r), firstIso: first, raceIso: r.raceStartIso,
      outline: c ? { d: circuitPath(c), width: c.width, height: c.height } : null,
      winner: w ? { name: w.name, team: w.teamName, color: p.teamColour(w.teamSlug) } : null,
    };
  });
  const months: Array<{ month: string; rounds: number[] }> = [];
  races.forEach((race) => {
    const m = MONTH(race);
    const last = months.at(-1);
    if (last && last.month === m) last.rounds.push(race.round);
    else months.push({ month: m, rounds: [race.round] });
  });
  // Re-read the page (winners, the next race) a little after each race start still ahead this season.
  const watch = races.filter((r) => Date.parse(r.raceStartIso) > now).slice(0, 2).flatMap((r) => [r.raceStartIso, new Date(Date.parse(r.raceStartIso) + 3 * 3_600_000).toISOString()]);

  return (
    <article className="bc">
      {races.length > 0 && !complete && <AutoRefresh everyMs={300_000} watch={watch} />}
      {/* Title band */}
      <section aria-labelledby="calendar-title" className="relative isolate overflow-hidden pb-14 pt-6 md:pb-20 md:pt-10">
        <div aria-hidden className="bc-carbon absolute inset-0 -z-10 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0 -z-10 opacity-70" />
        <div className="ds-container">
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Schedule', href: '/schedule' }, ...(p.season !== p.currentSeason ? [{ label: String(p.season) }] : [])]} />
          <div className="mt-8 grid gap-10 md:mt-12 lg:grid-cols-12 lg:items-end lg:gap-8">
            <div className="min-w-0 lg:col-span-7">
              <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Formula 1 · {p.season} season</p>
              <h1 id="calendar-title" className="bc-display mt-5 text-[clamp(2.8rem,8vw,6.5rem)]">{p.season}<span className="block text-[0.62em] text-[color:var(--bc-silver)]">Calendar</span></h1>
              {races.length > 0 && (
                <>
                  <p className="mt-6 max-w-[44ch] text-[1.05rem] leading-relaxed text-white">
                    {races.length} rounds{sprints ? `, ${sprints} sprint weekends` : ''}, {countries} {countries === 1 ? 'country' : 'countries'}{complete ? ', all run' : ''}.
                  </p>
                  <p className="mt-2 max-w-[52ch] text-[0.9rem] text-[color:var(--bc-silver)]">
                    {timed ? <>Session times in <ClockName reserve className="text-white" /></> : `Start times are not recorded for ${p.season} races, only the dates.`}
                  </p>
                  {timed && <p className="mt-1 text-[0.9rem] text-[color:var(--bc-silver)]">Weekend dates are each circuit’s local days.</p>}
                </>
              )}
            </div>
            {races.length > 0 && (
              <div className="min-w-0 lg:col-span-5">
                <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-[18px] bg-[color:var(--bc-rule)] ring-1 ring-[color:var(--bc-rule)]">
                  {[['Run', <>{run}<span className="ml-1 font-text text-[0.8rem] text-[color:var(--bc-titanium)]">/{races.length}</span></>], ['Sprints', sprints], ['Countries', countries]].map(([k, v]) => (
                    <div key={String(k)} className="min-w-0 bg-[color:var(--bc-night)] p-4 md:p-5">
                      <dt className="bc-label text-[color:var(--bc-titanium)]">{k}</dt>
                      <dd className="bc-mono mt-2 text-[clamp(1.5rem,3vw,2.2rem)] leading-none text-white">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4" role="img" aria-label={`${run} of ${races.length} rounds run`}>
                  <span aria-hidden className="block h-[3px] overflow-hidden rounded-full bg-white/10">
                    <span className="bc-in-fill block h-full rounded-full bg-[linear-gradient(90deg,#ffffff,var(--bc-red))]" style={{ width: `${(run / Math.max(1, races.length)) * 100}%` }} />
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <TabLinks label="Season" className="min-w-0 flex-1 [&_ul]:-mx-1.5 [&_ul]:-my-1.5 [&_ul]:flex-wrap [&_ul]:gap-x-5 [&_ul]:px-1.5 [&_ul]:py-1.5 max-[359px]:[&_li:nth-child(5):not(:has([aria-current]))]:hidden" items={tabYears.map((y) => ({ href: hrefFor(y), label: String(y), current: y === p.season }))} />
            <SeasonPicker seasons={allYears} current={p.season} hrefFor="/schedule/{season}" />
          </div>
        </div>
      </section>

      {races.length === 0 ? (
        <section className="border-t border-[color:var(--bc-rule)] py-16">
          <div className="ds-container">
            <p className="bc-wide text-[1.3rem]">The {p.season} calendar is not out yet</p>
            <p className="mt-2 max-w-[52ch] text-[color:var(--bc-silver)]">It appears here as soon as it is announced.</p>
            <Link href="/schedule" className="mt-5 inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">Current calendar <span aria-hidden>→</span></Link>
          </div>
        </section>
      ) : (
        <>
          {focus && <NextRace race={focus} now={now} facts={factsForRound(focus, p.circuitFacts.get(circuitFactsKey(focus)))} />}

          <section aria-labelledby="rounds-title" className="border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-night)] py-16 lg:py-24">
            <div className="ds-container">
              <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
                <div>
                  <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />{complete ? 'Every round run' : `${run} of ${races.length} run`}</p>
                  <h2 id="rounds-title" className="bc-display mt-4 text-[clamp(1.9rem,4.6vw,3.6rem)]">Every round</h2>
                </div>
                {p.winnersState === 'unavailable' && <p className="max-w-[40ch] text-[0.85rem] text-[color:var(--bc-titanium)]">Winners can’t be shown right now. Please check back in a few minutes.</p>}
              </div>
              <div className="mt-10 md:mt-12">
                <SeasonPosters months={months} rounds={rounds} serverNow={now} winnersUnavailable={p.winnersState === 'unavailable'} />
              </div>
              <div className="mt-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <Link href={`/results/${p.season}/drivers`} className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">{p.season} standings <span aria-hidden>→</span></Link>
                  <Link href="/results/archive" className="inline-flex min-h-11 items-center gap-2 text-[0.92rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">Every season since 1950 <span aria-hidden>→</span></Link>
                </div>
                <p className="text-[0.875rem] text-[color:var(--bc-titanium)]">The calendar can change when the FIA updates it.</p>
              </div>
            </div>
          </section>
        </>
      )}
    </article>
  );
}

function NextRace({ race, now, facts }: { race: UiRace; now: number; facts?: CircuitFacts }) {
  const c = facts?.showOutline ? getCircuit(race.circuitId) : null;
  const zone = zoneOf(race);
  return (
    // id="next": the menu's "Next race" link (/schedule#next) lands here; [id] gets the header's scroll margin from globals.
    <section id="next" aria-labelledby="next-race-title" className="relative overflow-hidden border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-carbon)] py-16 lg:py-24">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.07),transparent)]" />
      <div className="ds-container relative">
        <p className="bc-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Next race · Round {race.round}</p>
        <h2 id="next-race-title" className="bc-display mt-4 text-[clamp(2rem,4.6vw,3.8rem)]">
          <Link href={routeOf(race)} className="transition-colors hover:text-[color:var(--bc-silver)]">{race.name}</Link>
        </h2>
        {/* R3-TIME-7: the dates are the circuit's own days, said so beside the reader-zone session times. */}
        <p className="mt-3 text-[1rem] text-[color:var(--bc-silver)]">{race.circuitName} · {race.city}, {race.country} · <span className="text-white">{weekendRange(race)}</span>{zone || /^\d{4}-\d{2}-\d{2}$/.test(race.raceStartIso) ? ' (local dates)' : ''}</p>
        <div className="mt-10 grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="min-w-0 lg:col-span-7">
            <NextRaceSessions sessions={chronological(race.sessions)} serverNow={now} />
            <Link href={routeOf(race)} className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-[color:var(--bc-white)] px-5 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.96] motion-reduce:transform-none">Race weekend <span aria-hidden>→</span></Link>
          </div>
          {c && (
            <figure className="min-w-0 lg:col-span-5">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] bg-[color:var(--bc-night)] p-[6%] ring-1 ring-[color:var(--bc-rule)]">
                <div aria-hidden className="bc-carbon absolute inset-0 opacity-60" />
                <div className="relative h-full w-full"><CircuitStreak d={circuitPath(c)} width={c.width} height={c.height} label={`Layout of ${race.circuitName}`} /></div>
              </div>
              <figcaption className="mt-3 flex flex-wrap justify-between gap-x-4 text-[0.85rem] text-[color:var(--bc-silver)]">
                <span>{race.circuitName}</span>
                <span className="bc-mono">Lap {formatLapLength(facts)}</span>
              </figcaption>
            </figure>
          )}
        </div>
      </div>
    </section>
  );
}
