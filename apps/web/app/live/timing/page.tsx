import type { Metadata } from 'next';
import { openf1, type OpenF1Lap, type OpenF1Stint, type OpenF1Weather } from '@apex/api-client/openf1';
import { Container, SourceNote, Unavailable } from '@/components/ds';
import { SectionTitle } from '@/components/info/carbon';
import { getGrid, type GridDriver } from '@/lib/grid';
import { countedFastestLap, failureReason, loadSheet, settle } from '@/components/live/sheet';
import { OtherScreens, SheetFrame, SheetUnavailable } from '@/components/live/SheetFrame';
import { ClassificationTable, FrontRow, GapRibbon } from '@/components/live/Classification';
import { SessionConditions, StrategyChart } from '@/components/live/RaceDetail';
import { getStartingGrid, type StartingGridRow } from '@/components/live/openf1-history';
import { buildClassification, isQualiKind, isRaceKind, officialBest, sessionClock } from '@/components/live/sheet-model';
import { withSocial } from '@/lib/page-metadata';

type Props = { searchParams: Promise<{ session?: string | string[] }> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state !== 'ready') {
    return withSocial({ title: 'Session classification', description: 'Final classification of the latest finished Formula 1 session.', alternates: { canonical: '/live/timing' } });
  }
  const winner = ctx.result.find((r) => r.position === 1);
  const who = winner ? ctx.drivers.get(winner.driver_number) : null;
  return withSocial({
    title: `${ctx.title} ${ctx.season}: ${ctx.session.session_name} classification`,
    description: `Final ${ctx.session.session_name.toLowerCase()} classification of the ${ctx.season} ${ctx.title}${who ? `, led by ${who.firstName} ${who.lastName} (${who.team})` : ''}.`,
    alternates: { canonical: '/live/timing' },
  });
}

export default async function LiveTimingPage({ searchParams }: Props) {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state === 'unavailable') return <SheetUnavailable screen="timing" title="Classification" reason={ctx.reason} cause={ctx.cause} liveNow={ctx.liveNow} next={ctx.next} requested={ctx.requested} />;
  if (ctx.state === 'none') return <SheetUnavailable screen="timing" title="Classification" reason={ctx.notice} liveNow={ctx.liveNow} next={ctx.next} />;

  const { session, kind } = ctx;
  const key = session.session_key;
  const race = isRaceKind(kind);
  // The starting grid sits under the qualifying session that set it.
  const gridSource = race
    ? ctx.weekend.filter((w) => (kind === 'sprint' ? w.kind === 'sprint-qualifying' : w.kind === 'qualifying') && Date.parse(w.start) < Date.parse(session.date_start)).at(-1)
    : undefined;
  const READ = { strict: true, timeoutMs: 8_000, revalidate: 3600 } as const;

  const [grid, stints, laps, weather, roster] = await Promise.all([
    gridSource ? settle<StartingGridRow[]>(() => getStartingGrid(gridSource.key), []) : Promise.resolve({ value: [] as StartingGridRow[], ok: true, cause: null }),
    race ? settle<OpenF1Stint[]>(() => openf1.getStints(key, READ), []) : Promise.resolve({ value: [] as OpenF1Stint[], ok: true, cause: null }),
    // Every session gets its fastest lap, not only races.
    settle<OpenF1Lap[]>(() => openf1.getLaps(key, READ), []),
    settle<OpenF1Weather[]>(() => openf1.getWeather(key, READ), []),
    getGrid().catch((): GridDriver[] => []),
  ]);

  const rows = buildClassification(kind, ctx.result, ctx.drivers, grid.value);
  // Full-body cut-outs for the night podium: only a driver whose code and surname both match the current grid (never another season's person).
  const cutouts = new Map<number, string>();
  for (const r of rows.slice(0, 3)) {
    const g = roster.find((d) => d.code === r.driver.code && d.lastName.toLowerCase() === r.driver.lastName.toLowerCase());
    if (g?.cutout) cutouts.set(r.number, g.cutout);
  }
  const totalLaps = rows.reduce((m, r) => Math.max(m, r.laps ?? 0), 0);
  // Only a lap that counts: deleted laps are out, and practice/qualifying follow the official best time.
  const counted = await countedFastestLap(ctx, laps.value);
  const quickest = counted.lap;
  const official = counted.unmatched ? officialBest(kind, rows) : null;
  const codeOf = (n: number) => ctx.drivers.get(n)?.code ?? `#${n}`;
  const fastest = quickest
    ? { time: quickest.lap_duration!, lap: quickest.lap_number, code: codeOf(quickest.driver_number) }
    : official ? { time: official.time, lap: null, code: codeOf(official.driver) } : null;
  const ended = sessionClock(session.date_end);
  const caption = isQualiKind(kind)
    ? `${ctx.title}, ${session.session_name}: final classification. Purple marks the fastest time of each segment; the gap is to the fastest time in the segment where each driver was classified.`
    : race
      ? `${ctx.title}, ${session.session_name}: final classification with grid positions, laps, time or gap to the winner and points.`
      : `${ctx.title}, ${session.session_name}: best lap per driver and gap to the fastest.`;

  return (
    <SheetFrame ctx={ctx} screen="timing">
      {rows.length === 0 ? (
        <Container className="py-20">
          <div className="bcp-panel p-7 md:p-10">
            <p className="bc-wide text-[clamp(1.3rem,1rem+1.2vw,2rem)] text-white">Classification not in yet</p>
            <p className="mt-3 max-w-[58ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">The {session.session_name.toLowerCase()} classification for {ctx.title} arrives shortly after the chequered flag.</p>
          </div>
        </Container>
      ) : (
        <>
          <FrontRow kind={kind} rows={rows} cutouts={cutouts} />
          <GapRibbon kind={kind} rows={rows} />
          <section aria-labelledby="sheet-title" className="py-20 md:py-28">
            <Container>
              <div className="max-w-[68rem]">
                <SectionTitle id="sheet-title" eyebrow="The timing sheet" title="Classification" />
                <div className="bcp-panel mt-10 overflow-hidden px-1 pb-2 pt-5 sm:px-3 md:mt-12">
                  <ClassificationTable kind={kind} rows={rows} caption={caption} />
                </div>
                {race && !grid.ok && <p className="mt-4 font-text text-small text-fg-2">Grid positions can’t be shown right now, so places gained and lost are left out.</p>}
                <SourceNote className="mt-6" updated={<>Session ended {ended.day}, {ended.utc} UTC</>} />
              </div>
            </Container>
          </section>
          {race && (stints.ok ? <StrategyChart rows={rows} stints={stints.value} totalLaps={totalLaps} /> : (
            <Container className="py-[var(--space-block)]"><Unavailable compact title="Strategy unavailable">{failureReason(stints.cause ?? 'network', 'the tyre strategy')}</Unavailable></Container>
          ))}
          <SessionConditions weather={weather.value} fastest={fastest} />
        </>
      )}
      <OtherScreens current="timing" sessionKey={key} />
    </SheetFrame>
  );
}
