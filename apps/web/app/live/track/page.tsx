import type { Metadata } from 'next';
import { cn } from '@apex/ui';
import { openf1, type OpenF1Lap, type OpenF1Location } from '@apex/api-client/openf1';
import { Container, Grid, Label, Media, Portrait, Unavailable } from '@/components/ds';
import { SectionTitle } from '@/components/info/carbon';
import { countedFastestLap, failureReason, loadSheet, settle } from '@/components/live/sheet';
import { OtherScreens, SheetFrame, SheetUnavailable } from '@/components/live/SheetFrame';
import { TrackReplay } from '@/components/live/TrackReplay';
import { formatLapTime, projectTrace, rankedTop, speedAxis, speedTrap, type LapLike, type ReadFailure } from '@/components/live/sheet-model';
import { withSocial } from '@/lib/page-metadata';

type Props = { searchParams: Promise<{ session?: string | string[] }> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state !== 'ready') return withSocial({ title: 'Session track', description: 'The fastest lap of the latest finished Formula 1 session, traced around the circuit.', alternates: { canonical: '/live/track' } });
  return withSocial({
    title: `${ctx.title} ${ctx.season}: ${ctx.session.session_name} fastest lap on track`,
    description: `The fastest lap of the ${ctx.season} ${ctx.title} ${ctx.session.session_name.toLowerCase()}, traced around the circuit, with sector times and speed-trap readings.`,
    alternates: { canonical: '/live/track' },
  });
}

type Lap = OpenF1Lap & LapLike & { st_speed?: number | null };

const TRAP_ROW = 'grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 sm:grid-cols-[2.5rem_minmax(0,14rem)_minmax(0,1fr)_4.5rem]';

export default async function LiveTrackPage({ searchParams }: Props) {
  const ctx = await loadSheet(one((await searchParams).session));
  if (ctx.state === 'unavailable') return <SheetUnavailable screen="track" title="Track" reason={ctx.reason} cause={ctx.cause} liveNow={ctx.liveNow} next={ctx.next} requested={ctx.requested} />;
  if (ctx.state === 'none') return <SheetUnavailable screen="track" title="Track" reason={ctx.notice} liveNow={ctx.liveNow} next={ctx.next} />;

  const key = ctx.session.session_key;
  const lapsRead = await settle(async () => (await openf1.getLaps(key, { strict: true, timeoutMs: 8_000, revalidate: 3600 })) as Lap[], [] as Lap[]);
  const laps = lapsRead.value;
  // The lap that counts: race-control deletions are out; practice and qualifying follow the official best time.
  const { lap: best, unmatched } = await countedFastestLap(ctx, laps);
  let gpsRead: { value: OpenF1Location[]; ok: boolean; cause: ReadFailure | null } = { value: [], ok: true, cause: null };
  if (best?.date_start && best.lap_duration) {
    const startMs = Date.parse(best.date_start);
    const duration = best.lap_duration;
    gpsRead = await settle(() => openf1.getLocation(key, {
      strict: true, timeoutMs: 8_000, revalidate: 86_400, driverNumber: best.driver_number,
      dateGte: new Date(startMs - 250).toISOString(), dateLte: new Date(startMs + duration * 1000 + 250).toISOString(),
    }), [] as OpenF1Location[]);
  }
  const gps = gpsRead.value;
  const traceFailure = !lapsRead.ok ? lapsRead.cause : !gpsRead.ok ? gpsRead.cause : null;
  const trace = best?.date_start ? projectTrace(gps, best.date_start) : { points: [], width: 1000, height: 1000 };
  const driver = best ? ctx.drivers.get(best.driver_number) : undefined;
  // Top ten with shared places: equal readings share a rank and a tie at tenth keeps every tied car.
  const trap = rankedTop(speedTrap(laps), 10);
  const trapAxis = speedAxis(trap.at(-1)?.speed ?? 0, trap[0]?.speed ?? 0);
  const image = ctx.meeting?.circuit_image && ctx.meeting.circuit_image.startsWith('https://media.formula1.com/') ? ctx.meeting.circuit_image : null;
  const name = driver ? `${driver.firstName} ${driver.lastName}` : best ? `Car ${best.driver_number}` : '';

  return (
    <SheetFrame ctx={ctx} screen="track">
      <section aria-labelledby="lap-title" className="py-20 md:py-28">
        <Container>
          <Grid className="gap-y-10">
            <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-8">
              <SectionTitle id="lap-title" eyebrow="One lap, traced" title="Fastest lap" />
              <div className="mt-10">
                {traceFailure ? (
                  <Unavailable title="Lap trace unavailable">{failureReason(traceFailure, 'the lap trace')}</Unavailable>
                ) : !best && unmatched ? (
                  <Unavailable title="Fastest lap trace unavailable">The trace for the official fastest lap is not available for this session, so no other lap is shown in its place.</Unavailable>
                ) : !best ? (
                  <Unavailable title="No timed lap in this session">There is no complete timed lap for this session, so there is no trace to show.</Unavailable>
                ) : trace.points.length < 20 ? (
                  <Unavailable title="Lap trace unavailable">There is not enough position data for this lap to trace it accurately.</Unavailable>
                ) : (
                  <TrackReplay
                    points={trace.points}
                    width={trace.width}
                    height={trace.height}
                    sectors={[best.duration_sector_1 ?? null, best.duration_sector_2 ?? null, best.duration_sector_3 ?? null]}
                    lapTime={best.lap_duration!}
                    color={driver?.color ?? '#f4f4f5'}
                    code={driver?.code ?? `#${best.driver_number}`}
                    label={`${ctx.session.location}: the fastest lap of the session, ${name}, lap ${best.lap_number}, traced from ${trace.points.length} GPS samples. Red square marks where the lap started.`}
                  />
                )}
              </div>
            </div>

            <section aria-label="Lap details" className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-4">
              {best && driver !== undefined && (
                <div className="bcp-panel overflow-hidden lg:mt-[4.5rem]">
                  <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-4 p-4 lg:grid-cols-1 lg:p-0">
                    <Portrait src={driver.headshot} name={name} framing="bust" teamColor={driver.color} glare sizes="(max-width: 1024px) 112px, 30vw" frameClassName="rounded-[14px] lg:rounded-none" />
                    <div className="min-w-0 lg:px-6 lg:pt-5">
                      <p className="text-[0.95rem] text-[color:var(--bc-silver)]">{driver.firstName}</p>
                      <p className="bc-wide text-[clamp(1.2rem,1rem+0.9vw,1.7rem)] leading-[1.05] text-white [overflow-wrap:anywhere]">{driver.lastName}</p>
                      <p className="mt-1 flex items-center gap-2.5 font-text text-small text-fg-2">
                        <span aria-hidden className="h-[1.1em] w-1 shrink-0" style={{ backgroundColor: driver.color ?? 'var(--rule-strong)' }} />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{driver.team}</span>
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 pt-2 lg:p-6">
                    <div><dt className="font-text text-label uppercase text-fg-3">Lap time</dt><dd className="mt-1.5"><span className="bc-mono text-[1.45rem] text-white">{formatLapTime(best.lap_duration)}</span></dd></div>
                    <div><dt className="font-text text-label uppercase text-fg-3">Lap</dt><dd className="bc-mono mt-1.5 text-[1.45rem] text-white">{best.lap_number}</dd></div>
                    {typeof best.st_speed === 'number' && <div><dt className="font-text text-label uppercase text-fg-3">Trap, this lap</dt><dd className="mt-1.5 font-text text-ui font-[650] text-fg">{best.st_speed} km/h</dd></div>}
                    <div><dt className="font-text text-label uppercase text-fg-3">GPS samples</dt><dd className="mt-1.5 font-text text-ui font-[650] text-fg">{trace.points.length}</dd></div>
                  </dl>
                </div>
              )}
              {image && (
                <div className="bcp-panel mt-4 overflow-hidden p-4 md:p-5">
                  <Label as="p" className="mb-3">Official circuit map</Label>
                  <Media src={image} alt={`${ctx.session.circuit_short_name} circuit map`} kind="circuit" sizes="(max-width: 1024px) 100vw, 30vw" />
                </div>
              )}
            </section>
          </Grid>
        </Container>
      </section>

      {trap.length >= 3 && (
        <section aria-labelledby="trap-title" className="bc-carbon border-y border-[color:var(--bc-rule)] py-20 md:py-28">
          <Container>
            <div className="max-w-[60rem]">
              <SectionTitle id="trap-title" eyebrow="Top speed" title="Speed trap">
                The highest reading each driver set at the speed trap across the whole session, in km/h. Equal readings share a place; a tie for tenth keeps every tied car.
              </SectionTitle>
              {/* A strip plot of ticks, not bars: the readings differ by a few percent, so a bar from zero would hide them and a bar from a raised floor would exaggerate them. */}
              <div className="bcp-panel mt-10 p-4 sm:p-6 md:mt-12 md:p-8" role="figure" aria-labelledby="trap-title">
                <ol className="grid">
                  {trap.map((row, i) => {
                    const d = ctx.drivers.get(row.driver);
                    // A shared place repeats its number (1, 1, 3) and reads "joint" to screen readers.
                    const shared = i > 0 && trap[i - 1]!.rank === row.rank;
                    return (
                      <li key={row.driver} className={TRAP_ROW}>
                        <span className={cn('bc-wide text-[1.3rem] leading-none text-white', shared && 'text-[color:var(--bc-silver)]')}>
                          {row.tied && <span className="sr-only">Joint </span>}{row.rank}
                        </span>
                        <span className="min-w-0">
                          <span className="font-text text-ui font-[750] tracking-[0.04em]">{d?.code ?? `#${row.driver}`}</span>
                          <span className="ml-2 hidden font-text text-small text-fg-2 sm:inline [overflow-wrap:anywhere]">{d ? `${d.firstName} ${d.lastName}` : ''}</span>
                        </span>
                        <span aria-hidden className="relative block h-11">
                          {trapAxis.ticks.map((t) => (
                            <span key={t} className="absolute inset-y-0 w-px bg-[var(--rule)]" style={{ left: `${trapAxis.at(t)}%` }} />
                          ))}
                          <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--rule-strong)]" />
                          <span
                            className="absolute top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_12px_currentColor]"
                            style={{ left: `${trapAxis.at(row.speed)}%`, backgroundColor: d?.color ?? '#8d8f98', color: d?.color ?? '#8d8f98' }}
                          />
                        </span>
                        <span className="bc-mono text-right text-[1rem] text-white">{row.speed}<span className="sr-only"> km/h on lap {row.lap}</span></span>
                      </li>
                    );
                  })}
                </ol>
                <div aria-hidden className={cn(TRAP_ROW, 'pt-2')}>
                  <span />
                  <span />
                  <span className="relative block h-5">
                    {trapAxis.ticks.map((t, i) => (
                      <span
                        key={t}
                        className={cn('absolute top-0 font-text text-caption tabular-nums text-fg-3', i === 0 ? 'translate-x-0' : i === trapAxis.ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2')}
                        style={{ left: `${trapAxis.at(t)}%` }}
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="text-right font-text text-caption text-fg-3">km/h</span>
                </div>
              </div>
              <p className="mt-4 font-text text-caption text-fg-3">Each mark is a driver’s top reading. The scale runs from {trapAxis.min} to {trapAxis.max} km/h so differences of a few km/h stay readable.</p>
            </div>
          </Container>
        </section>
      )}
      <div className="h-20" />
      <OtherScreens current="track" sessionKey={key} />
    </SheetFrame>
  );
}
