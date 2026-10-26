import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import type { JolpicaPitStopEntry, JolpicaQualifyingEntry, JolpicaResultEntry, UiResult } from '@apex/api-client/jolpica';
import { mapResult } from '@apex/api-client/jolpica';
import { cn } from '@apex/ui';
import { NEUTRAL_TEAM_COLOUR } from '@/lib/team-colours';
import { ClockTime } from './SessionClock';
import { RaceTabs, type RaceTab } from './RaceTabs';
import { fastestLapOf, formatPoints, gapText, gridLabel, lapSeconds, pitLaneSeconds, pitStopIso, placesGained, pointsLabel, positionLabel, reachedPart, type RaceResultsState } from './weekend';
import type { SessionRead } from './data';

/* ---------------------------------------------------------------------------
 * The weekend's timing sheets, Carbon & Light: race, sprint, qualifying and
 * pit stops as tabs. Team colour is light (a bar, a glow behind the podium),
 * never text. Gaps are as published; a lapped car reads "+1 lap"; a car out
 * of the race names its status. Only sessions with something to say get a
 * tab; one that has not run, or could not be read, says so in words.
 * ------------------------------------------------------------------------- */

type ColourOf = (constructorId: string | null | undefined) => string | null;

export interface ResultsSheetProps {
  raceName: string;
  season: number;
  race: { state: 'available'; results: UiResult[] } | { state: 'unavailable' } | { state: 'not-run' };
  /** The race has run (its classification may still be on its way). */
  raceDone: boolean;
  sprint: SessionRead<JolpicaResultEntry[]>;
  qualifying: SessionRead<JolpicaQualifyingEntry[]>;
  pitStops: SessionRead<JolpicaPitStopEntry[]>;
  colourOf: ColourOf;
  retryHref: string;
  /** Race start and the track's UTC offset, to place pit-stop times of day on the reader's clock. */
  raceStartIso: string;
  offsetMin: number | null;
  /** Session kinds in time order, to open on the latest published result. */
  sessionOrder: string[];
  /** From raceResultsState: an empty read long after the race is "not published", not "on its way" (R3-TIME-1). */
  resultsState?: RaceResultsState;
}

const TH = 'bc-label px-2 pb-3 text-left text-[0.66rem] font-[650] text-[color:var(--bc-titanium)]';
const TD = 'px-2 py-3 align-middle';
const NUM = 'text-right tabular-nums';

function Bar({ color, tall }: { color: string | null; tall?: boolean }) {
  return <span aria-hidden className={cn('inline-block w-[3px] shrink-0 rounded-full', tall ? 'h-7' : 'h-4')} style={{ backgroundColor: color ?? 'rgb(255 255 255 / 0.18)' }} />;
}

function Name({ first, last, href }: { first: string; last: string; href: string }) {
  return (
    <Link href={href} className="group inline-flex min-h-11 items-center py-1 [overflow-wrap:anywhere]">
      <span className="bg-[linear-gradient(var(--bc-red),var(--bc-red))] bg-[length:0%_2px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size] duration-300 group-hover:bg-[length:100%_2px] group-focus-visible:bg-[length:100%_2px]">
        <span className="text-[color:var(--bc-silver)]">{first} </span><span className="font-semibold text-[color:var(--bc-white)]">{last}</span>
      </span>
    </Link>
  );
}

function Note({ title, children, action }: { title: string; children: ReactNode; action?: { label: string; href: string } }) {
  return (
    <div className="max-w-[60ch] rounded-[18px] p-6 ring-1 ring-[color:var(--bc-rule)] md:p-8">
      <p className="bc-wide text-[1.1rem]">{title}</p>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">{children}</p>
      {action && <a href={action.href} className="mt-4 inline-flex min-h-11 items-center gap-2 text-[0.9rem] font-medium text-white underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-[6px]">{action.label} <span aria-hidden>→</span></a>}
    </div>
  );
}

function Change({ r }: { r: UiResult }) {
  const d = placesGained(r);
  if (d === null) return <span className="text-[color:var(--bc-titanium)]">–</span>;
  if (d === 0) return <span className="text-[color:var(--bc-titanium)]"><span aria-hidden>0</span><span className="sr-only">No change</span></span>;
  return d > 0
    ? <span className="text-[#4ade80]"><span aria-hidden>+{d}</span><span className="sr-only">Gained {d}</span></span>
    : <span className="text-[color:var(--bc-red-text)]"><span aria-hidden>−{-d}</span><span className="sr-only">Lost {-d}</span></span>;
}

/** Race or sprint classification as a timing board. */
function Classification({ caption, results, colourOf }: { caption: string; results: UiResult[]; colourOf: ColourOf }) {
  const winnerLaps = results[0]?.laps ?? null;
  const fastest = fastestLapOf(results);
  const hasGrid = results.some((r) => r.grid != null);
  return (
    <div className="-mx-2 overflow-x-auto [scrollbar-width:thin]">
      <table className="w-full min-w-[18rem] border-collapse text-[0.95rem]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[color:var(--bc-rule-strong)]">
            <th scope="col" className={cn(TH, 'w-12')}>Pos</th>
            <th scope="col" className={TH}>Driver</th>
            <th scope="col" className={cn(TH, 'hidden md:table-cell')}>Team</th>
            {hasGrid && <th scope="col" className={cn(TH, NUM, 'hidden w-20 lg:table-cell')}>Grid</th>}
            {hasGrid && <th scope="col" className={cn(TH, NUM, 'hidden w-16 lg:table-cell')}>+/−</th>}
            <th scope="col" className={cn(TH, NUM, 'hidden w-16 sm:table-cell')}>Laps</th>
            <th scope="col" className={cn(TH, NUM)}><span className="sm:hidden">Gap · pts</span><span className="hidden sm:inline">Time / gap</span></th>
            <th scope="col" className={cn(TH, NUM, 'hidden w-14 sm:table-cell')}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const colour = colourOf(r.constructor?.slug);
            const g = gapText(r, winnerLaps);
            const classified = /^\d+$/.test(r.positionText);
            const podium = classified && i < 3;
            const out = !g.timing && !g.text.startsWith('+');
            return (
              <tr
                key={r.driver.slug}
                className={cn('border-b border-[color:var(--bc-rule)] transition-colors hover:bg-white/[0.03]', podium && colour && 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--team)_16%,transparent),transparent_45%)]')}
                style={podium && colour ? ({ '--team': colour } as CSSProperties) : undefined}
              >
                <td className={cn(TD, 'bc-wide whitespace-nowrap', classified ? 'text-[1.05rem] text-[color:var(--bc-white)]' : 'text-[0.8rem] text-[color:var(--bc-titanium)]')}>{positionLabel(r)}</td>
                <th scope="row" className={cn(TD, 'text-left font-normal')}>
                  <span className="flex min-w-0 items-center gap-3">
                    <Bar color={colour} tall={podium} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Name first={r.driver.firstName} last={r.driver.lastName} href={`/drivers/${r.driver.slug}`} />
                      <span className="text-[0.8rem] text-[color:var(--bc-titanium)] md:hidden">{r.constructor?.name ?? 'Team not published'}{out ? <span className="sm:hidden"> · {g.text}</span> : null}</span>
                      {r === fastest && r.fastestLap && (
                        <span className="mt-0.5 inline-flex flex-wrap items-center gap-x-2 text-[0.78rem] text-[color:var(--bc-silver)]">
                          <span aria-hidden className="h-[3px] w-4 rounded-full bg-[#b26bff]" />
                          Fastest lap <span className="bc-mono text-white">{r.fastestLap.time}</span><span className="text-[color:var(--bc-titanium)]">lap {r.fastestLap.lap}</span>
                        </span>
                      )}
                    </span>
                  </span>
                </th>
                <td className={cn(TD, 'hidden text-[color:var(--bc-silver)] md:table-cell')}><span className="[overflow-wrap:anywhere]">{r.constructor?.name ?? 'Not published'}</span></td>
                {hasGrid && <td className={cn(TD, NUM, 'hidden text-[color:var(--bc-silver)] lg:table-cell')}>{gridLabel(r)}</td>}
                {hasGrid && <td className={cn(TD, NUM, 'hidden lg:table-cell')}><Change r={r} /></td>}
                <td className={cn(TD, NUM, 'hidden text-[color:var(--bc-silver)] sm:table-cell')}>{r.laps ?? '–'}</td>
                <td className={cn(TD, NUM, 'whitespace-nowrap')}>
                  <span className="flex flex-col items-end gap-0.5">
                    {g.timing ? <span className="bc-mono text-[color:var(--bc-white)]">{g.text}</span>
                      : g.text.startsWith('+') ? <span className="text-[color:var(--bc-silver)]">{g.text}</span>
                        : <><span className="hidden text-[color:var(--bc-titanium)] sm:inline">{g.text}</span><span aria-hidden className="text-[color:var(--bc-titanium)] sm:hidden">Out</span></>}
                    <span className={cn('text-[0.78rem] sm:hidden', r.points > 0 ? 'font-semibold text-white' : 'text-[color:var(--bc-titanium)]')}>{pointsLabel(r.points)}</span>
                  </span>
                </td>
                <td className={cn(TD, NUM, 'hidden sm:table-cell', r.points > 0 ? 'font-semibold text-white' : 'text-[color:var(--bc-titanium)]')}>{formatPoints(r.points)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ k, v, note }: { k: string; v: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-[color:var(--bc-rule)] py-5 first:border-t-0 first:pt-0">
      <dt className="bc-label text-[color:var(--bc-titanium)]">{k}</dt>
      <dd className="bc-mono mt-2 text-[clamp(1.4rem,2vw,1.8rem)] leading-none text-white">{v}</dd>
      {note && <dd className="mt-2 text-[0.85rem] leading-snug text-[color:var(--bc-silver)]">{note}</dd>}
    </div>
  );
}

function RaceFacts({ results, pitStops }: { results: UiResult[]; pitStops: SessionRead<JolpicaPitStopEntry[]> }) {
  const winner = results[0];
  const fastest = fastestLapOf(results);
  const classified = results.filter((r) => /^\d+$/.test(r.positionText)).length;
  const stops = pitStops.state === 'available' ? pitStops.data : null;
  const quickest = stops?.map((s) => ({ s, sec: pitLaneSeconds(s.duration) })).filter((x): x is { s: JolpicaPitStopEntry; sec: number } => x.sec != null).sort((a, b) => a.sec - b.sec)[0];
  const quickName = quickest ? results.find((r) => r.driver.id === quickest.s.driverId)?.driver.lastName ?? quickest.s.driverId : null;
  return (
    <dl className="rounded-[18px] bg-[color:var(--bc-carbon)] p-6 ring-1 ring-[color:var(--bc-rule)] md:p-7">
      {winner?.time && <Fact k="Winning time" v={winner.time} note={`${winner.driver.lastName}, ${winner.laps ?? '–'} laps`} />}
      {fastest?.fastestLap && <Fact k="Fastest lap" v={fastest.fastestLap.time} note={`${fastest.driver.lastName}, lap ${fastest.fastestLap.lap}`} />}
      <Fact k="Classified" v={<>{classified}<span className="ml-1.5 font-text text-[0.9rem] text-[color:var(--bc-titanium)]">of {results.length}</span></>} />
      {stops && stops.length > 0 && <Fact k="Pit stops" v={stops.length} note={quickest ? `Quickest pit lane ${quickest.sec.toFixed(3)} s, ${quickName}` : undefined} />}
    </dl>
  );
}

/** Qualifying with Q1, Q2 and Q3; the quickest time of each part is marked, and the cut lines fall where drivers were knocked out. */
function Qualifying({ caption, rows, colourOf }: { caption: string; rows: JolpicaQualifyingEntry[]; colourOf: ColourOf }) {
  const parts = (['Q1', 'Q2', 'Q3'] as const).filter((p) => rows.some((r) => r[p]?.trim()));
  const best = (r: JolpicaQualifyingEntry) => { const p = reachedPart(r); return p ? r[p] : undefined; };
  const fastestOf = Object.fromEntries(parts.map((p) => [p, Math.min(...rows.map((r) => lapSeconds(r[p]) ?? Infinity))])) as Record<string, number>;
  const pole = lapSeconds(best(rows[0]!));
  return (
    <div className="space-y-4">
      <div className="-mx-2 overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full min-w-[18rem] border-collapse text-[0.95rem]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-[color:var(--bc-rule-strong)]">
              <th scope="col" className={cn(TH, 'w-12')}>Pos</th>
              <th scope="col" className={TH}>Driver</th>
              <th scope="col" className={cn(TH, 'hidden md:table-cell')}>Team</th>
              {parts.map((p) => <th key={p} scope="col" className={cn(TH, NUM, 'hidden w-24 sm:table-cell')}>{p}</th>)}
              <th scope="col" className={cn(TH, NUM, 'sm:hidden')}>Best</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const reached = reachedPart(r);
              const prev = i > 0 ? reachedPart(rows[i - 1]!) : reached;
              const cut = i > 0 && prev !== reached && reached !== null;
              const colour = colourOf(r.Constructor?.constructorId);
              const b = lapSeconds(best(r));
              return (
                <tr key={r.Driver.driverId} className={cn('border-b border-[color:var(--bc-rule)]', cut && 'border-t-2 border-t-[color:var(--bc-red)]')}>
                  <td className={cn(TD, 'bc-wide text-[1.05rem]')}>
                    {r.position}
                    {cut && <span className="sr-only"> (out in {reached})</span>}
                  </td>
                  <th scope="row" className={cn(TD, 'text-left font-normal')}>
                    <span className="flex min-w-0 items-center gap-3">
                      <Bar color={colour} tall={i === 0} />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <Name first={r.Driver.givenName} last={r.Driver.familyName} href={`/drivers/${r.Driver.driverId}`} />
                        <span className="text-[0.8rem] text-[color:var(--bc-titanium)] md:hidden">{r.Constructor?.name}{reached && parts.length > 1 ? ` · ${reached === 'Q3' ? 'Reached Q3' : `Out in ${reached}`}` : ''}</span>
                      </span>
                    </span>
                  </th>
                  <td className={cn(TD, 'hidden text-[color:var(--bc-silver)] md:table-cell')}>{r.Constructor?.name}</td>
                  {parts.map((p) => {
                    const t = r[p]?.trim();
                    const purple = t && lapSeconds(t) === fastestOf[p];
                    return (
                      <td key={p} className={cn(TD, NUM, 'hidden sm:table-cell')}>
                        {t ? <span className={cn('bc-mono', purple ? 'rounded-[4px] bg-[#b26bff]/20 px-1.5 py-0.5 text-[#e2c8ff]' : 'text-[color:var(--bc-white)]')}>{t}{purple && <span className="sr-only"> (quickest in {p})</span>}</span>
                          : <span className="text-[color:var(--bc-titanium)]"><span aria-hidden>–</span><span className="sr-only">No time</span></span>}
                      </td>
                    );
                  })}
                  <td className={cn(TD, NUM, 'sm:hidden')}>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="bc-mono text-white">{best(r)?.trim() || '–'}</span>
                      {i > 0 && b != null && pole != null && <span className="bc-mono text-[0.75rem] text-[color:var(--bc-titanium)]">+{(b - pole).toFixed(3)}</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {parts.length > 1 && <p className="text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">The quickest time in each part is marked. A red line falls where drivers were knocked out. A dash: no time in that part.</p>}
    </div>
  );
}

/** Pit stops: every car's stops on a lap line (in finishing order), then the full list. */
function PitStops({ caption, stops, results, nameOf, colourOf, raceStartIso, offsetMin }: { caption: string; stops: JolpicaPitStopEntry[]; results: UiResult[]; nameOf: Map<string, UiResult>; colourOf: ColourOf; raceStartIso: string; offsetMin: number | null }) {
  const sorted = [...stops].sort((a, b) => Number(a.lap) - Number(b.lap) || a.time.localeCompare(b.time));
  const laps = Math.max(results[0]?.laps ?? 0, ...stops.map((s) => Number(s.lap) || 0), 1);
  const quick = Math.min(...stops.map((s) => pitLaneSeconds(s.duration) ?? Infinity));
  const order = results.length ? results.map((r) => r.driver.id) : [...new Set(sorted.map((s) => s.driverId))];
  const byDriver = new Map<string, JolpicaPitStopEntry[]>();
  sorted.forEach((s) => byDriver.set(s.driverId, [...(byDriver.get(s.driverId) ?? []), s]));
  return (
    <div className="space-y-10">
      <div>
        <p className="bc-label text-[color:var(--bc-titanium)]">Stops by lap · lap 1 to {laps}</p>
        <ul className="mt-4 space-y-1.5">
          {order.filter((id) => byDriver.has(id)).map((id) => {
            const r = nameOf.get(id);
            const list = byDriver.get(id)!;
            const colour = colourOf(r?.constructor?.slug);
            return (
              <li key={id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_1.5rem] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_2rem]">
                <span className="flex min-w-0 items-center gap-2 text-[0.85rem]">
                  <Bar color={colour} />
                  <span className="truncate font-semibold text-white"><span className="sm:hidden">{r?.driver.code || r?.driver.lastName || id}</span><span className="hidden sm:inline">{r?.driver.lastName ?? id}</span></span>
                </span>
                <span className="relative h-6">
                  <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
                  {list.map((s) => {
                    const sec = pitLaneSeconds(s.duration);
                    const best = sec != null && sec === quick;
                    return <span key={s.stop} aria-hidden title={`Lap ${s.lap}${sec != null ? `, ${sec.toFixed(3)} s` : ''}`} className={cn('absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full', best ? 'bg-[#b26bff]' : 'bg-white')} style={{ left: `${(Number(s.lap) / laps) * 100}%` }} />;
                  })}
                  <span className="sr-only">{list.length === 1 ? 'Stopped on lap' : 'Stopped on laps'} {list.map((s) => s.lap).join(', ')}</span>
                </span>
                <span className="bc-mono text-right text-[0.85rem] text-[color:var(--bc-silver)]">{list.length}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[0.875rem] text-[color:var(--bc-titanium)]">Each mark is a stop. Purple: the quickest pit-lane time of the race.</p>
      </div>
      <div className="-mx-2 overflow-x-auto [scrollbar-width:thin]">
        <table className="w-full min-w-[18rem] border-collapse text-[0.95rem]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-[color:var(--bc-rule-strong)]">
              <th scope="col" className={cn(TH, NUM, 'w-14')}>Lap</th>
              <th scope="col" className={TH}>Driver</th>
              <th scope="col" className={cn(TH, NUM, 'w-14')}>Stop</th>
              <th scope="col" className={cn(TH, NUM, 'hidden sm:table-cell')}>Time</th>
              <th scope="col" className={cn(TH, NUM)}>Pit lane</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => {
              const r = nameOf.get(s.driverId);
              const sec = pitLaneSeconds(s.duration);
              const iso = pitStopIso(raceStartIso, s.time, offsetMin);
              return (
                <tr key={`${s.driverId}-${s.stop}`} className="border-b border-[color:var(--bc-rule)]">
                  <td className={cn(TD, NUM, 'text-[color:var(--bc-silver)]')}>{s.lap}</td>
                  <th scope="row" className={cn(TD, 'text-left font-normal')}>
                    <span className="flex items-center gap-3"><Bar color={colourOf(r?.constructor?.slug)} />{r ? <span className="[overflow-wrap:anywhere]"><span className="text-[color:var(--bc-silver)]">{r.driver.firstName} </span><span className="font-semibold text-white">{r.driver.lastName}</span></span> : s.driverId}</span>
                  </th>
                  <td className={cn(TD, NUM, 'text-[color:var(--bc-silver)]')}>{s.stop}</td>
                  <td className={cn(TD, NUM, 'hidden sm:table-cell')}>{iso ? <ClockTime iso={iso} className="bc-mono text-[color:var(--bc-silver)]" /> : <span className="bc-mono text-[color:var(--bc-silver)]">{s.time} <span className="font-text text-[0.75rem] text-[color:var(--bc-titanium)]">local</span></span>}</td>
                  <td className={cn(TD, NUM)}>{sec == null ? '–' : <span className={cn('bc-mono', sec === quick ? 'text-[#e2c8ff]' : 'text-white')}>{sec.toFixed(3)} s</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">Pit lane is the time from pit entry to pit exit, not the stationary time.{offsetMin != null ? ' Times follow the clock chosen for the weekend.' : ''}</p>
    </div>
  );
}

function sessionNote(title: string, read: SessionRead<unknown>, retryHref: string, notRun: string, pending: string) {
  if (read.state === 'not-run') return <Note title={`${title} not run yet`}>{notRun}</Note>;
  if (read.state === 'unavailable') return <Note title={`${title} unavailable`} action={{ label: 'Try again', href: retryHref }}>This classification can’t be shown right now. Please try again in a few minutes.</Note>;
  return <Note title={`${title} not in yet`}>{pending}</Note>;
}

export function ResultsSheet(p: ResultsSheetProps) {
  const tabs: RaceTab[] = [];
  const nameOf = new Map<string, UiResult>();
  const has = (read: SessionRead<unknown[]>) => read.state === 'available' && read.data.length > 0;
  const raceResults = p.race.state === 'available' ? p.race.results : [];
  raceResults.forEach((r) => nameOf.set(r.driver.id, r));

  // Race
  tabs.push({
    id: 'race',
    label: 'Race',
    note: raceResults.length ? 'Final' : undefined,
    content: raceResults.length ? (
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-12">
        <div className="min-w-0"><Classification caption={`${p.raceName} ${p.season}: race classification`} results={raceResults} colourOf={p.colourOf} /></div>
        <section aria-label="Race facts" className="min-w-0"><RaceFacts results={raceResults} pitStops={p.pitStops} /></section>
      </div>
    ) : p.race.state === 'unavailable' || p.resultsState === 'unavailable'
      // A failed read is never presented as "results on the way" (R3-TIME-1).
      ? <Note title="Race classification unavailable" action={{ label: 'Try again', href: p.retryHref }}>The race classification can’t be shown right now. Please try again in a few minutes.</Note>
      : p.raceDone
        ? p.resultsState === 'not-published'
          ? <Note title="No classification published">No classification has been published for this race.</Note>
          : <Note title="Results not in yet">The race has finished. Its classification arrives shortly after the chequered flag.</Note>
        : <Note title="Race not run yet">The classification appears here shortly after the chequered flag.</Note>,
  });

  // Sprint
  if (p.sprint.state !== 'not-covered') {
    const rows = p.sprint.state === 'available' ? p.sprint.data.map(mapResult) : [];
    rows.forEach((r) => { if (!nameOf.has(r.driver.id)) nameOf.set(r.driver.id, r); });
    tabs.push({
      id: 'sprint',
      label: 'Sprint',
      note: rows.length ? 'Final' : undefined,
      content: rows.length
        ? <Classification caption={`${p.raceName} ${p.season}: sprint classification`} results={rows} colourOf={p.colourOf} />
        : sessionNote('Sprint results', p.sprint, p.retryHref, 'The sprint classification appears after the sprint finishes.', 'The sprint has finished. Its classification arrives shortly.'),
    });
  }

  // Qualifying
  tabs.push({
    id: 'qualifying',
    label: 'Qualifying',
    note: has(p.qualifying as SessionRead<unknown[]>) ? 'Final' : undefined,
    content: p.qualifying.state === 'available' && p.qualifying.data.length
      ? <Qualifying caption={`${p.raceName} ${p.season}: qualifying`} rows={p.qualifying.data} colourOf={p.colourOf} />
      : sessionNote('Qualifying results', p.qualifying, p.retryHref, 'Qualifying times appear here after the session finishes.', 'Qualifying has finished. The times arrive shortly.'),
  });

  // Pit stops
  if (p.pitStops.state === 'available' && p.pitStops.data.length) {
    tabs.push({
      id: 'pit-stops',
      label: 'Pit stops',
      content: <PitStops caption={`${p.raceName} ${p.season}: pit stops`} stops={p.pitStops.data} results={raceResults} nameOf={nameOf} colourOf={p.colourOf} raceStartIso={p.raceStartIso} offsetMin={p.offsetMin} />,
    });
  } else if (p.pitStops.state === 'unavailable') {
    tabs.push({ id: 'pit-stops', label: 'Pit stops', content: sessionNote('Pit stops', p.pitStops, p.retryHref, '', '') });
  }

  // Open on the latest session (in time order) with a published result.
  const published: Array<{ id: string; kind: string }> = [
    ...(raceResults.length ? [{ id: 'race', kind: 'R' }] : []),
    ...(p.sprint.state === 'available' && p.sprint.data.length ? [{ id: 'sprint', kind: 'S' }] : []),
    ...(p.qualifying.state === 'available' && p.qualifying.data.length ? [{ id: 'qualifying', kind: 'Q' }] : []),
  ];
  const at = (kind: string) => p.sessionOrder.indexOf(kind);
  const initial = published.sort((a, b) => at(b.kind) - at(a.kind))[0]?.id ?? 'race';
  return <RaceTabs tabs={tabs} initial={initial} label="Weekend results" />;
}

/** Team colour only where a live provider colour exists; historic teams carry no invented stripe. */
export function makeColourOf(colours: Readonly<Record<string, string>>): ColourOf {
  return (id) => {
    const c = id ? colours[id] : undefined;
    return c && c.toUpperCase() !== NEUTRAL_TEAM_COLOUR.toUpperCase() ? c : null;
  };
}
