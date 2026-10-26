'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGroup, m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';
import { Headshot } from '@/components/ds';
import { spring } from '@/components/motion/tokens';
import { SeasonChart } from './SeasonChart';
import { fmtPoints } from './sheet';

/** Shared stroke patterns (also used by the race lap chart). */
export { dashFor, LINE_DASH } from './SeasonChart';

/* ---------------------------------------------------------------------------
 * Championship board, Carbon & Light: the season chart, a replay scrubber
 * and the timing sheet, all driven by one round index.
 *
 *  - At the latest round the sheet is the official standings table.
 *  - At an earlier round it is computed from that season's race and sprint
 *    points and says so; the page only passes a progression when the running
 *    totals reproduce the official table exactly.
 *  - Rows slide to their new places when the round changes (layout spring);
 *    reduced motion reorders instantly. Replay walks the season round by
 *    round and stops at the official table.
 * ------------------------------------------------------------------------- */

export interface BoardRow {
  id: string;
  position: number | null;
  positionLabel: string;
  first: string;
  last: string;
  href: string;
  /** Team (drivers) or nationality / line-up (constructors). */
  sub: string;
  subHref: string | null;
  colour: string | null;
  headshot: string | null;
  code: string | null;
  points: number;
  wins: number;
}

export interface BoardProgression {
  rounds: Array<{ round: number; name: string }>;
  totals: Record<string, number[]>;
  positions: Record<string, number[]>;
}

const STEP_MS = 650;
const UP = 'text-[#5ee08f]';

export function StandingsBoard({ kind, season, rows, progression, progressionNote = null, showHeadshots, caption, tableRound = null, decided = false, alive = null, tableNote = null, subLabel }: {
  kind: 'drivers' | 'teams';
  season: number;
  rows: BoardRow[];
  progression: BoardProgression | null;
  /** Why the chart is absent, in plain words. */
  progressionNote?: string | null;
  showHeadshots: boolean;
  caption: string;
  /** Round the official table was published after. */
  tableRound?: number | null;
  /** The season is over: P1 at the final round is the champion. */
  decided?: boolean;
  /** Ids that can still win the title (season in progress), leader first. */
  alive?: string[] | null;
  /** A note shown above the sheet when the published table differs from the official classification. */
  tableNote?: string | null;
  /** Heading of the second column: Team, Drivers or Nationality. */
  subLabel?: string;
}) {
  const last = progression ? progression.rounds.length - 1 : 0;
  const [index, setIndex] = useState(last);
  const [selected, setSelected] = useState<string | null>(rows[0]?.id ?? null);
  const [playing, setPlaying] = useState(false);
  const reduced = Boolean(useReducedMotion());
  const atLatest = !progression || index === last;
  const hasChart = Boolean(progression && progression.rounds.length > 1);

  // Replay: one round per step, stopping on the official table.
  const running = playing && index < last;
  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIndex((i) => Math.min(last, i + 1)), STEP_MS);
    return () => window.clearTimeout(t);
  }, [running, index, last]);

  const go = (i: number) => { setPlaying(false); setIndex(i); };
  const toggle = () => {
    if (running) { setPlaying(false); return; }
    if (index >= last) setIndex(0);
    setPlaying(true);
  };

  const table = useMemo(() => {
    if (atLatest || !progression) {
      return rows.map((r) => {
        const prev = progression && last > 0 ? progression.positions[r.id]?.[last - 1] ?? null : null;
        return { row: r, label: r.positionLabel, points: r.points, change: prev != null && r.position != null ? prev - r.position : null };
      });
    }
    return rows
      .map((r) => {
        const pos = progression.positions[r.id]?.[index] ?? Number.POSITIVE_INFINITY;
        const prev = index > 0 ? progression.positions[r.id]?.[index - 1] ?? null : null;
        return { row: r, label: Number.isFinite(pos) ? String(pos) : '–', pos, points: progression.totals[r.id]?.[index] ?? 0, change: prev != null && Number.isFinite(pos) ? prev - pos : null };
      })
      .sort((a, b) => a.pos - b.pos);
  }, [atLatest, progression, rows, index, last]);

  const leaderPoints = table[0]?.points ?? 0;
  const roundName = progression?.rounds[index];
  const unranked = rows.some((r) => r.position == null);
  // Title cut-off under the last entry who can still draw level (official table only). At earlier
  // rounds the row stays in place, invisible, at the foot of the sheet, so the page never shifts.
  const aliveSet = alive ? new Set(alive) : null;
  const cutLatest = aliveSet ? rows.reduce((at, r, i) => (aliveSet.has(r.id) ? i : at), -1) : -1;
  const hasCut = cutLatest >= 0 && cutLatest < rows.length - 1;
  const cutAfter = atLatest ? cutLatest : table.length - 1;

  return (
    <div className="flex flex-col gap-12 md:gap-16">
      {hasChart && progression ? (
        <section aria-labelledby="season-chart-title" className="relative overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] p-4 ring-1 ring-[color:var(--bc-rule)] sm:p-6 lg:p-8">
          <SeasonChart
            titleId="season-chart-title"
            progression={progression}
            rows={rows}
            index={index}
            selected={selected}
            onSelect={setSelected}
            onIndex={go}
            kind={kind}
            playing={running}
          />
          <Replay progression={progression} index={index} playing={running} onIndex={go} onToggle={toggle} />
        </section>
      ) : progressionNote ? (
        <div role="note" className="rounded-[22px] bg-[color:var(--bc-carbon)] p-5 ring-1 ring-[color:var(--bc-rule)] sm:p-6">
          <p className="bc-label text-[color:var(--bc-silver)]">Round-by-round chart</p>
          <p className="mt-2 max-w-[70ch] text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">{progressionNote}</p>
        </div>
      ) : null}

      <section aria-labelledby="sheet-title">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Timing sheet</p>
            <h2 id="sheet-title" className="bc-display mt-4 text-[clamp(1.9rem,4vw,3.2rem)]">{atLatest ? 'Standings' : `After round ${roundName?.round}`}</h2>
          </div>
          {/* Both lines share one cell, so the header keeps the height of the longer one while scrubbing. */}
          <p className="grid max-w-[52ch] text-[0.92rem] leading-relaxed text-[color:var(--bc-silver)]">
            <span className={cn('[grid-area:1/1]', !atLatest && 'invisible')} aria-hidden={!atLatest || undefined}>
              {`Official ${season} ${kind === 'drivers' ? 'drivers’' : 'constructors’'} championship table${progression ? `, after round ${progression.rounds[last]!.round} (${progression.rounds[last]!.name})` : tableRound != null ? `, after round ${tableRound}` : ''}.`}
            </span>
            <span className={cn('[grid-area:1/1]', atLatest && 'invisible')} aria-hidden={atLatest || undefined}>
              {roundName ? `Computed from the points scored in rounds 1 to ${roundName.round}, up to the ${roundName.name}. Move the scrubber to the end for the official table.` : null}
            </span>
          </p>
        </div>

        {tableNote && (
          <div role="note" className="mt-8 flex max-w-[78ch] gap-4 rounded-[18px] bg-[color:var(--bc-carbon)] p-5 ring-1 ring-[color:var(--bc-rule)]">
            <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-[color:var(--bc-red)]" />
            <p className="text-[0.92rem] leading-relaxed text-[color:var(--bc-silver)]"><span className="bc-label mb-1.5 block text-[color:var(--bc-white)]">Official classification</span>{tableNote}</p>
          </div>
        )}
        <div role="region" aria-label={caption} tabIndex={0} className="mt-8 overflow-hidden [&_a:focus-visible]:outline-offset-[-3px]! rounded-[22px] bg-[color:var(--bc-carbon)] ring-1 ring-[color:var(--bc-rule)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--bc-white)]">
          <table className="w-full border-collapse text-left text-[0.95rem]">
            <caption className="sr-only">{caption}{atLatest ? '' : `, after round ${roundName?.round}`}</caption>
            <thead>
              <tr className="border-b border-[color:var(--bc-rule-strong)]">
                <Th className="w-[4.5rem] pl-4 sm:w-[6rem] sm:pl-6">Pos</Th>
                <Th>{kind === 'drivers' ? 'Driver' : 'Constructor'}</Th>
                <Th className="hidden md:table-cell md:w-[22%] lg:w-[18%]">{subLabel ?? (kind === 'drivers' ? 'Team' : 'Drivers')}</Th>
                <Th className="hidden w-[4.5rem] text-right sm:table-cell">Wins</Th>
                <Th className="hidden w-[6rem] text-right sm:table-cell">Gap</Th>
                <Th className="pr-4 text-right sm:pr-6 lg:w-[28%]">Pts</Th>
              </tr>
            </thead>
            <LayoutGroup>
              <tbody>
                {table.map(({ row, label, points, change }, i) => {
                  const lead = i === 0;
                  const isSel = selected === row.id;
                  const gap = lead ? (atLatest && decided ? 'Champion' : 'Leader') : `+${fmtPoints(leaderPoints - points)}`;
                  const share = leaderPoints > 0 ? Math.max(0, Math.min(1, points / leaderPoints)) : 0;
                  return (
                    <Fragment key={row.id}>
                      <m.tr
                        layout={reduced ? false : 'position'}
                        transition={spring.settle}
                        onMouseEnter={() => setSelected(row.id)}
                        onFocus={() => setSelected(row.id)}
                        className={cn('relative border-b border-[color:var(--bc-rule)] transition-colors hover:bg-white/[0.04]', lead && 'bg-white/[0.045]', isSel && !lead && 'bg-white/[0.025]')}
                      >
                        <td className="relative py-2 pl-4 align-middle sm:pl-6">
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          <span className="flex items-center gap-2">
                            <span className="bc-wide min-w-[2ch] text-[1.05rem] text-[color:var(--bc-white)] sm:text-[1.2rem]">{label}</span>
                            <Change value={change} />
                          </span>
                          {lead && <span className="sr-only">{atLatest && decided ? ' (champion)' : ' (championship leader)'}</span>}
                        </td>
                        <th scope="row" className="relative py-2 pr-3 text-left max-md:py-0 align-middle font-normal">
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          <span className="flex min-w-0 items-center gap-3">
                            <span aria-hidden className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: row.colour ?? 'var(--bc-rule-strong)' }} />
                            {showHeadshots && kind === 'drivers' && (
                              <Headshot src={row.headshot} name={`${row.first} ${row.last}`} teamColor={row.colour} size={40} className="hidden shrink-0 xs:block" />
                            )}
                            <span className="min-w-0">
                              {/* Phones: the team is its own 44px link under the name (no nested links); without a single team page it stays part of the name target. */}
                              <Link href={row.href} className={cn('flex min-h-11 flex-col py-1 leading-tight', row.subHref ? 'justify-center max-md:justify-end max-md:pb-0.5' : 'justify-center')}>
                                <span className={cn('[overflow-wrap:anywhere]', isSel && 'underline decoration-[color:var(--bc-red)] decoration-2 underline-offset-4')}>
                                  {row.first && <span className="text-[color:var(--bc-silver)]">{row.first} </span>}
                                  <span className="font-semibold text-[color:var(--bc-white)]">{row.last}</span>
                                </span>
                                {!row.subHref && <span className="mt-0.5 block text-[0.85rem] text-[color:var(--bc-titanium)] [overflow-wrap:anywhere] md:hidden">{row.sub}</span>}
                              </Link>
                              {row.subHref && (
                                <Link href={row.subHref} className="flex min-h-11 items-start pt-0.5 text-[0.85rem] text-[color:var(--bc-titanium)] [overflow-wrap:anywhere] hover:text-white md:hidden">{row.sub}</Link>
                              )}
                            </span>
                          </span>
                        </th>
                        <td className="relative hidden py-2 pr-3 align-middle text-[color:var(--bc-silver)] md:table-cell">
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          {row.subHref ? <Link href={row.subHref} className="inline-flex min-h-11 items-center [overflow-wrap:anywhere] hover:text-white">{row.sub}</Link> : <span className="[overflow-wrap:anywhere]">{row.sub}</span>}
                        </td>
                        {/* Wins are published with the official table only; earlier rounds leave the cell empty (the column stays, so nothing shifts). */}
                        <td className="bc-mono relative hidden py-2 pr-3 text-right align-middle text-[color:var(--bc-silver)] sm:table-cell">
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          {atLatest ? row.wins : <span className="sr-only">Not shown for earlier rounds</span>}
                        </td>
                        <td className={cn('relative hidden py-2 pr-3 text-right align-middle sm:table-cell', lead ? 'text-[0.82rem] text-[color:var(--bc-silver)]' : 'bc-mono text-[color:var(--bc-silver)]')}>
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          {gap}
                        </td>
                        <td className="relative py-2 pr-4 text-right align-middle sm:pr-6">
                          {lead && <span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-[color:var(--bc-red)]" />}
                          <span className="flex items-center justify-end gap-5">
                            {/* Wide screens: points as a share of the leader's, in team colour, so the sheet reads as a chart. The number carries the value. */}
                            <span aria-hidden className="relative hidden h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.07] lg:block">
                              <span
                                className="absolute inset-0 origin-left rounded-full transition-transform duration-500 ease-[var(--bc-ease)] motion-reduce:transition-none"
                                style={{ transform: `scaleX(${share})`, background: row.colour ?? 'var(--bc-silver)', opacity: lead || isSel ? 1 : 0.8 }}
                              />
                            </span>
                            <span className="min-w-[3.5ch]">
                              <span className="bc-mono block text-[1.02rem] font-medium text-[color:var(--bc-white)]">{fmtPoints(points)}</span>
                              <span className={cn('block text-[0.74rem] text-[color:var(--bc-titanium)] sm:hidden', !lead && 'bc-mono')}>{gap}</span>
                            </span>
                          </span>
                        </td>
                      </m.tr>
                      {hasCut && i === cutAfter && (
                        <tr aria-hidden className={cn('border-b border-[color:var(--bc-rule)]', !atLatest && 'invisible')}>
                          <td colSpan={6} className="px-4 py-2 sm:px-6">
                            <span className="flex items-center gap-3 text-[0.74rem] font-semibold uppercase tracking-[0.12em] text-[color:var(--bc-red-text)]">
                              <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--bc-red),transparent)]" />
                              Title cut-off
                              <span className="h-px flex-1 bg-[linear-gradient(270deg,var(--bc-red),transparent)]" />
                            </span>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </LayoutGroup>
          </table>
        </div>
        {(hasCut || unranked) && (
          <ul className="mt-4 space-y-1 text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">
            {hasCut && <li>Above the title cut-off: still able to draw level with the leader on points if they win every remaining race and sprint.</li>}
            {unranked && <li>A dash in the position column means the entry is not ranked in the {season} championship.</li>}
          </ul>
        )}
        {!atLatest && <span className="sr-only" aria-live="polite">Table shows the standings after round {roundName?.round}, {roundName?.name}.</span>}
        {rows.length === 0 && <p className="mt-6 text-[color:var(--bc-titanium)]">No entries were published for this table.</p>}
      </section>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th scope="col" className={cn('bc-label py-3 pr-3 font-semibold text-[color:var(--bc-titanium)]', className)}>{children}</th>;
}

function Change({ value }: { value: number | null }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={cn('bc-mono inline-flex items-center gap-0.5 text-[0.74rem]', up ? UP : 'text-[color:var(--bc-red-text)]')}>
      <svg aria-hidden viewBox="0 0 10 10" className="size-2" fill="currentColor">{up ? <path d="M5 1 9 8H1z" /> : <path d="M5 9 1 2h8z" />}</svg>
      <span aria-hidden>{Math.abs(value)}</span>
      <span className="sr-only">{up ? `up ${value}` : `down ${-value}`} since the previous round</span>
    </span>
  );
}

/** Round scrubber with a replay of the season. Keyboard: the range input (arrows, Home, End) and the button. */
function Replay({ progression, index, playing, onIndex, onToggle }: { progression: BoardProgression; index: number; playing: boolean; onIndex: (i: number) => void; onToggle: () => void }) {
  const n = progression.rounds.length;
  const r = progression.rounds[index]!;
  const ref = useRef<HTMLInputElement>(null);
  const pct = n > 1 ? (index / (n - 1)) * 100 : 100;
  return (
    <div className="mt-6 border-t border-[color:var(--bc-rule)] pt-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={playing}
          className="inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-full bg-[color:var(--bc-white)] py-2 pl-4 pr-5 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-colors hover:bg-[color:var(--bc-silver)]"
        >
          <svg aria-hidden viewBox="0 0 12 12" className="size-3" fill="currentColor">{playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1 11 6l-8.5 5z" />}</svg>
          {playing ? 'Pause' : index >= n - 1 ? 'Replay the season' : 'Play'}
        </button>
        <label htmlFor="round-scrubber" className="min-w-0 flex-1 text-[0.95rem] text-[color:var(--bc-white)]">
          <span className="bc-label mr-2 text-[color:var(--bc-titanium)]">After round</span>
          <span className="bc-mono">{r.round}</span>
          <span className="text-[color:var(--bc-silver)]"> · {r.name}</span>
        </label>
      </div>
      <div className="relative mt-3">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/10" />
        <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-[3px] w-full origin-left -translate-y-1/2 rounded-full bg-[color:var(--bc-red)]" style={{ transform: `translateY(-50%) scaleX(${pct / 100})` }} />
        <input
          ref={ref}
          id="round-scrubber"
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={index}
          onChange={(e) => onIndex(Number(e.target.value))}
          aria-valuetext={`After round ${r.round}, ${r.name}`}
          className="bc-range relative h-11 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <div aria-hidden className="bc-mono flex justify-between text-[0.75rem] text-[color:var(--bc-titanium)]">
        <span>R{progression.rounds[0]!.round}</span>
        <span>R{progression.rounds[n - 1]!.round}</span>
      </div>
    </div>
  );
}
