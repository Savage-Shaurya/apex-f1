import { cn } from '@apex/ui';
import { Icon, Label, Portrait, SectorMark, Timing } from '@/components/ds';
import { SectionTitle } from '@/components/info/carbon';
import { NightPodium } from './NightPodium';
import {
  fastestPerSegment,
  formatGap,
  formatLapTime,
  isQualiKind,
  isRaceKind,
  niceAxis,
  positionChange,
  qualiCaption,
  ribbonLanes,
  type ClassifiedRow,
  type SheetKind,
} from './sheet-model';

/* ------------------------------------------------------------- front row */

const TRIO_TITLE: Record<SheetKind, string> = {
  race: 'Podium',
  sprint: 'Sprint podium',
  qualifying: 'Front of the grid',
  'sprint-qualifying': 'Sprint front row',
  practice: 'Fastest three',
};

function trioTime(kind: SheetKind, row: ClassifiedRow): { main: string | null; note: string | null } {
  if (isRaceKind(kind)) {
    return row.position === 1 ? { main: formatLapTime(row.time), note: 'Race time' } : { main: row.gap, note: 'Behind the winner' };
  }
  return { main: formatLapTime(row.time), note: row.position === 1 ? (isQualiKind(kind) ? 'Pole time' : 'Fastest lap') : row.gap ? `${row.gap} to P1` : null };
}

/**
 * The top three under the floodlight, set like a podium on wide screens
 * (2, 1, 3; the winner stands highest) and as a ranked list on phones. Each
 * driver is the ds Portrait cut-out in their own team light, never a sticker.
 */
function TrioCards({ kind, top, stage }: { kind: SheetKind; top: ClassifiedRow[]; stage: boolean }) {
  return (
        <ol className={cn('mt-10 grid grid-cols-1 gap-3 md:mt-14 md:grid-cols-3 md:items-end md:gap-5', stage && 'md:hidden')}>
          {top.map((row) => {
            const p1 = row.position === 1;
            const t = trioTime(kind, row);
            const name = `${row.driver.firstName} ${row.driver.lastName}`.trim();
            return (
              <li
                key={row.number}
                className={cn(
                  'bcp-panel group grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] items-center gap-4 overflow-hidden p-3 min-[400px]:grid-cols-[6.5rem_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] md:flex md:flex-col md:items-stretch md:gap-0 md:p-0',
                  row.position === 1 && 'md:order-2',
                  row.position === 2 && 'md:order-1 md:mb-0',
                  row.position === 3 && 'md:order-3',
                  p1 && 'shadow-[inset_0_2px_0_var(--bc-red),inset_0_0_0_1px_rgb(255_255_255/0.12)]',
                )}
              >
                <div className={cn('relative min-w-0', p1 ? 'md:px-[4%] md:pt-[4%]' : 'md:px-[12%] md:pt-[12%]')}>
                  <Portrait
                    src={row.driver.headshot}
                    name={name || row.driver.code}
                    alt={name || `Car ${row.number}`}
                    framing="bust"
                    teamColor={row.driver.color}
                    priority={p1}
                    glare
                    sizes="(max-width: 768px) 128px, 30vw"
                    frameClassName="rounded-[14px] md:rounded-[16px]"
                  />
                </div>
                <div className="min-w-0 md:p-6 lg:p-7">
                  <p className="flex items-baseline gap-3">
                    <span className="bc-display text-[clamp(2.4rem,1.6rem+2.4vw,4rem)] leading-none text-white" aria-label={`Position ${row.position}`}>
                      {row.position}
                    </span>
                    <span className="bc-mono text-[0.95rem] font-medium text-[color:var(--bc-silver)]" aria-hidden>{row.driver.code}</span>
                  </p>
                  <p className="mt-3 text-[0.95rem] text-[color:var(--bc-silver)]">{row.driver.firstName}</p>
                  <p className="bc-wide text-[clamp(1.05rem,0.9rem+0.9vw,1.6rem)] leading-[1.05] text-white [overflow-wrap:anywhere]">{row.driver.lastName}</p>
                  <p className="mt-2 flex min-w-0 items-center gap-2.5 text-[0.9rem] text-[color:var(--bc-silver)]">
                    <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: row.driver.color ?? 'var(--bc-graphite)' }} />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{row.driver.team}</span>
                  </p>
                  {t.main && (
                    <p className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:var(--bc-rule)] pt-4">
                      <span className="bc-mono text-[1.3rem] text-white">{t.main}</span>
                      {t.note && <span className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">{t.note}</span>}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
  );
}

export function FrontRow({ kind, rows, cutouts }: { kind: SheetKind; rows: ClassifiedRow[]; cutouts?: Map<number, string> }) {
  const top = rows.filter((r) => r.position != null && r.position <= 3).slice(0, 3);
  if (top.length === 0) return null;
  // The night podium needs all three real full-body cut-outs; otherwise everyone gets the studio card.
  const stage = top.length === 3 && Boolean(cutouts) && top.every((r) => cutouts!.has(r.number));
  const label = `${TRIO_TITLE[kind]}: ${top.map((r) => `${r.position}, ${r.driver.firstName} ${r.driver.lastName}`).join('; ')}.`;
  return (
    <section aria-labelledby="trio-title" className="relative isolate overflow-hidden py-20 md:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%] bg-[radial-gradient(ellipse_50%_60%_at_50%_0%,rgb(233_240_255/0.08),transparent_72%)]" />
      <div className="ds-container">
        <SectionTitle id="trio-title" eyebrow={isRaceKind(kind) ? 'At the flag' : 'Top of the timesheet'} title={TRIO_TITLE[kind]} />
        {stage && (
          <div className="mt-6 hidden md:block">
            <NightPodium rows={top} cutouts={cutouts!} label={label} />
            <ol className="mx-auto grid max-w-[72rem] grid-cols-[9fr_27fr_28fr_27fr_9fr] gap-x-3">
              {top.map((row) => {
                const t = trioTime(kind, row);
                return (
                  <li key={row.number} className={cn('min-w-0 text-center', row.position === 1 ? 'col-start-3 row-start-1' : row.position === 2 ? 'col-start-2 row-start-1' : 'col-start-4 row-start-1')}>
                    <p className="bc-label text-[color:var(--bc-titanium)]"><span className="sr-only">Position </span>P{row.position} · {row.driver.code}</p>
                    <p className="mt-2 text-[0.95rem] text-[color:var(--bc-silver)]">{row.driver.firstName}</p>
                    <p className={cn('bc-wide leading-[1.05] text-white [overflow-wrap:anywhere]', row.position === 1 ? 'text-[clamp(1.3rem,0.9rem+1.2vw,2rem)]' : 'text-[clamp(1.1rem,0.85rem+0.8vw,1.5rem)]')}>{row.driver.lastName}</p>
                    <p className="mt-2 inline-flex items-center gap-2 text-[0.9rem] text-[color:var(--bc-silver)]">
                      <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: row.driver.color ?? 'var(--bc-graphite)' }} />
                      {row.driver.team}
                    </p>
                    {t.main && (
                      <p className="mt-3">
                        <span className="bc-mono block text-[1.25rem] text-white">{t.main}</span>
                        {t.note && <span className="bc-label mt-1 block text-[0.66rem] text-[color:var(--bc-titanium)]">{t.note}</span>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <TrioCards kind={kind} top={top} stage={stage} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ gap ribbon */

/**
 * "How close was it" in one picture: every classified car on one seconds
 * axis (strip plot, direct labels, no legend). Phones get the same data as a
 * ranked bar list so labels never collide.
 */
export function GapRibbon({ kind, rows }: { kind: SheetKind; rows: ClassifiedRow[] }) {
  // Qualifying gaps are only comparable inside one segment: plot the Q3 runners.
  const pool = isQualiKind(kind) ? rows.filter((r) => r.group === 3) : rows;
  const LANES = 4;
  const { points, max } = ribbonLanes(pool, LANES, 0.068);
  if (points.length < 3 || max <= 0) return null;
  const axis = niceAxis(max);
  const ticks = Array.from({ length: Math.round(axis.max / axis.step) + 1 }, (_, i) => +(i * axis.step).toFixed(3));
  const leader = points[0]!;
  const title = isQualiKind(kind) ? 'Gaps to pole in the final segment' : isRaceKind(kind) ? 'Gaps to the winner at the flag' : 'Gaps to the fastest lap';
  const summary = `${title}: ${points.length} cars within ${formatGap(max)?.slice(1) ?? max} seconds. Full values are in the classification table below.`;
  const W = 1000;
  const laneH = 36;
  const top = 20;
  const axisY = top + LANES * laneH + 16;
  const H = axisY + 40;
  const x = (g: number) => 40 + (g / axis.max) * (W - 80);
  // One decimal count for every tick, taken from the step: 0.25 -> "+0.75", 0.5 -> "+1.5", 1 -> "+2".
  const decimals = axis.step >= 1 ? 0 : String(axis.step).split('.')[1]!.length;
  const tickText = (t: number) => (t === 0 ? '0' : `+${t.toFixed(decimals)}`);

  return (
    <section aria-labelledby="ribbon-title" className="bc-carbon border-y border-[color:var(--bc-rule)] py-16 md:py-20">
      <div className="ds-container">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <SectionTitle id="ribbon-title" size="s" eyebrow="The margins" title="How close it was" />
          <p className="bc-label text-[color:var(--bc-titanium)]">{title}, in seconds</p>
        </div>

        {/* Wide screens: a strip plot with direct labels. Shown from 1024px so SVG text never renders below 13px. */}
        <figure className="mt-8 hidden lg:block">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={summary}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top - 8} y2={axisY} stroke="var(--rule)" strokeWidth={1} />
                <text x={x(t)} y={axisY + 30} textAnchor="middle" fill="var(--fg-3)" fontSize={14} fontFamily="var(--font-hanken), sans-serif" letterSpacing="0.02em">
                  {tickText(t)}
                </text>
              </g>
            ))}
            <line x1={x(0)} x2={x(axis.max)} y1={axisY} y2={axisY} stroke="var(--rule-strong)" strokeWidth={1} />
            {points.map((p) => {
              const cx = x(p.gap);
              const ly = top + p.lane * laneH + 15;
              const fill = p.color ?? '#9e9ea8';
              return (
                <g key={p.number}>
                  <line x1={cx} x2={cx} y1={ly + 7} y2={axisY - 10} stroke={fill} strokeOpacity={0.5} strokeWidth={1.25} />
                  {/* A thin tick, not a dot: two cars a hundredth apart stay separate marks. */}
                  <rect x={cx - 2} y={axisY - 10} width={4} height={20} fill={fill} />
                  <text x={cx} y={ly} textAnchor="middle" fill="var(--fg)" fontSize={16} fontWeight={650} fontFamily="var(--font-hanken), sans-serif" letterSpacing="0.04em">
                    {p.code}
                  </text>
                </g>
              );
            })}
          </svg>
        </figure>

        <ol className="mt-6 grid gap-2.5 sm:max-w-[40rem] lg:hidden" aria-label={summary}>
          {points.map((p) => (
            <li key={p.number} className="grid grid-cols-[3.25rem_minmax(0,1fr)_5.25rem] items-center gap-3">
              <span className="font-text text-ui font-[650] text-fg">{p.code}</span>
              <span aria-hidden className="relative block h-2 bg-[var(--rule)]">
                <span className="absolute inset-y-0 left-0 block" style={{ width: `${Math.max(1.5, (p.gap / axis.max) * 100)}%`, backgroundColor: p.color ?? '#9e9ea8' }} />
              </span>
              <Timing className="text-right text-fg-2">{p.number === leader.number ? '0.000' : formatGap(p.gap)}</Timing>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- classification */

function Change({ value }: { value: number | null }) {
  // Not classified: no change to show, but the slot keeps its width so grid numbers stay aligned.
  if (value == null) return <span aria-hidden className="inline-block w-9" />;
  // No change is a short level bar, never a "0" (next to the grid slot "1 0" reads as "10").
  if (value === 0) return <span className="inline-flex w-9 items-center justify-end"><span aria-hidden className="block h-0.5 w-3 bg-fg-3" /><span className="sr-only">No change from the grid</span></span>;
  const up = value > 0;
  return (
    <span className={cn('inline-flex w-9 items-center justify-end gap-0.5 font-[650]', up ? 'text-sector-green' : 'text-red-ink')}>
      <Icon name={up ? 'chevron-up' : 'chevron-down'} size={16} strokeWidth={2.25} />
      <span aria-hidden>{Math.abs(value)}</span>
      <span className="sr-only">{up ? `Gained ${value}` : `Lost ${Math.abs(value)}`} {Math.abs(value) === 1 ? 'place' : 'places'} from the grid</span>
    </span>
  );
}

function DriverCell({ row }: { row: ClassifiedRow }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
        <span className="font-text text-ui font-[750] tracking-[0.04em] text-fg">{row.driver.code}</span>
        {/* Phones: the code plus the surname, so a name never breaks mid-word in the narrow column. */}
        <span className="min-w-0 font-text text-ui text-fg">
          <span className="hidden sm:inline">{row.driver.firstName} </span>{row.driver.lastName}
        </span>
      </span>
      <span className="mt-0.5 font-text text-small text-fg-2 [overflow-wrap:anywhere]">{row.driver.team}</span>
    </span>
  );
}

function TimeCell({ value, purple }: { value: number | null; purple?: boolean }) {
  const text = formatLapTime(value);
  if (!text) return <span className="font-text text-small text-fg-3">No time</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Timing className={cn(purple && 'font-[650]')}>{text}</Timing>
      {purple && <SectorMark kind="purple" className="h-1 w-8 bg-sector-purple" />}
    </span>
  );
}

const TH = 'bc-label px-3 pb-3 pt-1 text-left text-[0.68rem] text-[color:var(--bc-titanium)] first:pl-4 last:pr-0';
const TD = 'px-3 py-3.5 align-middle text-fg first:pl-4 last:pr-0';

/**
 * The timing sheet on paper. Real table semantics; on phones the columns
 * reduce to position, driver and the one number that matters, so no column
 * is ever cut off or scrolled out of sight.
 */
export function ClassificationTable({ kind, rows, caption }: { kind: SheetKind; rows: ClassifiedRow[]; caption: string }) {
  const quali = isQualiKind(kind);
  const race = isRaceKind(kind);
  const purple = quali ? fastestPerSegment(rows) : new Map<number, number>();
  const segNames = kind === 'sprint-qualifying' ? ['SQ1', 'SQ2', 'SQ3'] : ['Q1', 'Q2', 'Q3'];
  const hasGrid = race && rows.some((r) => r.grid != null);
  const columns = 2 + (quali ? 4 : race ? 3 + (hasGrid ? 1 : 0) : 2) + 1;

  return (
    <div className="min-w-0">
      <table className="w-full border-collapse font-text text-ui tabular-nums">
        <caption className="mb-4 px-4 text-left font-text text-small text-fg-2">{caption}</caption>
        <thead>
          <tr className="border-b border-rule-strong">
            <th scope="col" className={cn(TH, 'w-14')}>Pos</th>
            <th scope="col" className={TH}>Driver</th>
            {quali && segNames.map((s) => (
              <th key={s} scope="col" className={cn(TH, 'hidden text-right sm:table-cell')}>{s}</th>
            ))}
            {race && hasGrid && <th scope="col" className={cn(TH, 'hidden text-right md:table-cell')}>Grid</th>}
            {race && <th scope="col" className={cn(TH, 'hidden text-right md:table-cell')}>Laps</th>}
            {!race && !quali && <th scope="col" className={cn(TH, 'hidden text-right sm:table-cell')}>Best lap</th>}
            <th scope="col" className={cn(TH, 'text-right')}>{race ? 'Time / gap' : 'Gap'}</th>
            {race && <th scope="col" className={cn(TH, 'hidden text-right sm:table-cell')}>Pts</th>}
            {!race && <th scope="col" className={cn(TH, 'hidden text-right', quali ? 'lg:table-cell' : 'md:table-cell')}>Laps</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const previous = index > 0 ? rows[index - 1]!.group : null;
            const divider = quali && previous !== null && row.group !== previous;
            const lowered = quali && row.group !== 3;
            const best = formatLapTime(row.time);
            const phoneQuali = quali ? qualiCaption(row, segNames) : null;
            return [
              divider ? (
                <tr key={`cut-${row.group}`} className="border-b-2 border-rule-strong">
                  <td colSpan={columns} className="px-4 pb-2 pt-6">
                    <Label size="l" tone="default">{row.group === 2 ? `Knocked out in ${segNames[1]}` : `Knocked out in ${segNames[0]}`}</Label>
                  </td>
                </tr>
              ) : null,
              <tr key={row.number} className={cn('relative border-b border-rule transition-colors hover:bg-white/[0.025]', lowered && 'bg-white/[0.02]')}>
                <td className={cn(TD, 'relative')}>
                  <span aria-hidden className="absolute inset-y-2 left-0 w-[3px]" style={{ backgroundColor: row.driver.color ?? 'var(--rule-strong)' }} />
                  <span className="bc-wide text-[1.35rem] leading-none text-white">{row.position ?? <span className="font-text text-small font-[650] normal-case">{row.status}</span>}</span>
                </td>
                <th scope="row" className={cn(TD, 'text-left font-normal')}>
                  <DriverCell row={row} />
                  {/* Phones: the essentials of hidden columns, as words. */}
                  <span className="mt-1 block font-text text-caption text-fg-3 sm:hidden">
                    {/* One phrase per line: no separator ever dangles at a line end. */}
                    {phoneQuali?.map((part, i) => (
                      <span key={part} className="block whitespace-nowrap">
                        {i > 0 && <span className="sr-only">, </span>}
                        {part}
                      </span>
                    ))}
                    {!quali && !race && best ? `Best lap ${best}` : null}
                    {race && row.points ? `${row.points} pts` : null}
                    {row.status && row.position != null ? ` ${row.status}` : null}
                  </span>
                </th>
                {quali && segNames.map((s, i) => (
                  <td key={s} className={cn(TD, 'hidden text-right sm:table-cell')}>
                    {row.segments[i] != null ? <TimeCell value={row.segments[i]!} purple={purple.get(i) === row.number} /> : <span className="font-text text-small text-fg-3">{row.group != null && row.group > i ? 'No time set' : '-'}</span>}
                  </td>
                ))}
                {race && hasGrid && <td className={cn(TD, 'hidden text-right md:table-cell')}><span className="inline-flex items-center gap-2"><span className="text-fg-2"><span className="sr-only">Started </span>{row.grid ?? 'Pit lane'}</span><Change value={positionChange(row)} /></span></td>}
                {race && <td className={cn(TD, 'hidden text-right md:table-cell')}>{row.laps ?? '-'}</td>}
                {!race && !quali && <td className={cn(TD, 'hidden text-right sm:table-cell')}><TimeCell value={row.time} /></td>}
                <td className={cn(TD, 'text-right')}>
                  {race ? (
                    row.position === 1 ? <Timing className="font-[650]">{formatLapTime(row.time) ?? 'Winner'}</Timing>
                      : row.status ? <span className="font-text text-small font-[650]">{row.status}</span>
                        : <Timing>{row.gap ?? '-'}</Timing>
                  ) : row.position === 1 ? (
                    <span className="font-text text-small font-[650]">{quali ? 'Pole' : 'Fastest'}</span>
                  ) : row.gap ? <Timing>{row.gap}</Timing> : <span className="font-text text-small text-fg-3">{row.status ?? 'No time set'}</span>}
                </td>
                {race && <td className={cn(TD, 'hidden text-right sm:table-cell')}>{row.points ? <span className="font-[650]">{row.points}</span> : <span className="text-fg-3">0</span>}</td>}
                {!race && <td className={cn(TD, 'hidden text-right', quali ? 'lg:table-cell' : 'md:table-cell')}>{row.laps ?? '-'}</td>}
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
