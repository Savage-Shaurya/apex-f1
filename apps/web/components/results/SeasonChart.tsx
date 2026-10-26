'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@apex/ui';
import type { BoardProgression, BoardRow } from './StandingsBoard';
import { fmtPoints, seriesValue, type ChartMode } from './sheet';

/* ---------------------------------------------------------------------------
 * The season, round by round. One axis per view:
 *   points    running points (up is more)
 *   gap       points behind whoever led after that round (the leader runs
 *             along the top edge)
 *   position  championship position after each round (P1 on top)
 * Focus + context: the top five are drawn in their team colour with direct
 * end labels; everyone else is a faint context line. Teammates share a
 * colour, so each of the five also has its own stroke pattern, and names
 * label the lines: identity never rests on colour alone. The selected entry
 * is drawn thicker on top. During a replay the lines are lit only up to the
 * round shown, the rest of the season stays as a faint trace.
 * ------------------------------------------------------------------------- */

const PAD = { top: 18, right: 156, bottom: 34, left: 46 };
export const LINE_DASH = ['', '9 4', '1.5 3.5', '9 3 1.5 3', '4 3'] as const;
const NEUTRAL = ['#f4f5f7', '#c9ccd3', '#e9f0ff', '#9b9ea7', '#d9dbe1'];

export function dashFor(rank: number): string | undefined {
  return LINE_DASH[rank] || undefined;
}

/** Axis top: a 1/2/2.5/5 x 10^k step that gives about four intervals, rounded up to cover the data. */
export function niceAxis(v: number): { max: number; step: number } {
  if (!(v > 0)) return { max: 10, step: 2.5 };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const mm = raw / p;
  const step = (mm <= 1 ? 1 : mm <= 2 ? 2 : mm <= 2.5 ? 2.5 : mm <= 5 ? 5 : 10) * p;
  return { max: Math.ceil(v / step) * step, step };
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const MODES: Array<{ id: ChartMode; label: string }> = [
  { id: 'points', label: 'Points' },
  { id: 'gap', label: 'Gap to leader' },
  { id: 'position', label: 'Position' },
];

export function SeasonChart({ titleId, progression, rows, index, selected, onSelect, onIndex, kind, playing }: {
  titleId: string;
  progression: BoardProgression;
  rows: BoardRow[];
  index: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onIndex: (i: number) => void;
  kind: 'drivers' | 'teams';
  playing: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [mode, setMode] = useState<ChartMode>('points');
  const [hover, setHover] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(() => typeof window !== 'undefined' && (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const narrow = width > 0 && width < 640;
  const pad = narrow ? { ...PAD, right: 14, left: 38 } : PAD;
  const height = narrow ? 280 : 400;
  const n = progression.rounds.length;
  const lastIndex = n - 1;
  const focusIds = rows.slice(0, 5).map((r) => r.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const highlighted = [...new Set([...focusIds, ...(selected ? [selected] : [])])];
  const rankOf = (id: string) => focusIds.indexOf(id);
  const colourOf = (id: string) => byId.get(id)?.colour ?? NEUTRAL[Math.max(0, rankOf(id)) % NEUTRAL.length]!;
  const dashOf = (id: string) => { const i = rankOf(id); return i >= 0 ? dashFor(i) : '6 3 1 3'; };
  const nameOf = (id: string) => byId.get(id)?.last ?? id;
  const value = (id: string, i: number) => seriesValue(mode, progression.totals, progression.positions, id, i);

  // First sight: the lines draw left to right once (clip only, nothing moves; reduced motion skips it).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (drawn) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setDrawn(true); io.disconnect(); } }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, drawn]);

  const iw = Math.max(1, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * iw : iw / 2);

  let maxV = 1;
  let ticks: number[] = [];
  let y: (v: number) => number;
  if (mode === 'position') {
    maxV = Math.max(2, ...Object.values(progression.positions).flat());
    y = (v) => pad.top + ((v - 1) / Math.max(1, maxV - 1)) * ih;
    ticks = [1, ...[5, 10, 15, 20, 25, 30, 35, 40].filter((t) => t < maxV), maxV];
  } else {
    let top = 1;
    for (const id of Object.keys(progression.totals)) for (let i = 0; i < n; i++) top = Math.max(top, value(id, i) ?? 0);
    const axis = niceAxis(top);
    maxV = axis.max;
    ticks = Array.from({ length: Math.round(axis.max / axis.step) + 1 }, (_, i) => i * axis.step);
    y = mode === 'points' ? (v) => pad.top + ih - (v / maxV) * ih : (v) => pad.top + (v / maxV) * ih;
  }
  const tickEvery = Math.max(1, Math.ceil(n / (narrow ? 6 : 12)));
  const path = (id: string) => {
    let d = '';
    for (let i = 0; i < n; i++) {
      const v = value(id, i);
      if (v == null) continue;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    }
    return d;
  };

  // End labels for highlighted series at the round shown, nudged apart vertically (min 17px).
  const labelAt = index;
  const labels = highlighted
    .map((id) => ({ id, v: value(id, labelAt) ?? 0 }))
    .sort((a, b) => y(a.v) - y(b.v))
    .map((l) => ({ ...l, y: y(l.v) }));
  for (let i = 1; i < labels.length; i++) if (labels[i]!.y - labels[i - 1]!.y < 17) labels[i]!.y = labels[i - 1]!.y + 17;

  const active = hover ?? index;
  const idxAt = useCallback((clientX: number, rect: DOMRect) => {
    const rel = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1))));
  }, [n]);
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); onIndex(Math.min(n - 1, index + 1)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onIndex(Math.max(0, index - 1)); }
    if (e.key === 'Home') { e.preventDefault(); onIndex(0); }
    if (e.key === 'End') { e.preventDefault(); onIndex(n - 1); }
  };
  const tipRows = highlighted.map((id) => ({ id, v: value(id, active) })).filter((t) => t.v != null).sort((a, b) => (mode === 'points' ? b.v! - a.v! : a.v! - b.v!));
  const tipLeft = x(active) > width / 2;
  const clipW = !drawn ? 0 : index >= lastIndex ? width : Math.max(0, x(index) - pad.left + 1);
  const fmtV = (v: number) => (mode === 'position' ? `P${v}` : mode === 'gap' ? (v === 0 ? 'Leader' : `+${fmtPoints(v)}`) : fmtPoints(v));
  const yName = mode === 'points' ? 'Points' : mode === 'gap' ? 'Points behind' : 'Position';
  const subject = kind === 'drivers' ? 'drivers' : 'constructors';
  const clipId = `${titleId}-clip`;

  return (
    <figure className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="bc-label flex items-center gap-3 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Round by round</p>
          <h2 id={titleId} className="bc-wide mt-3 text-[clamp(1.25rem,2.2vw,1.7rem)] leading-tight">
            {mode === 'points' ? 'Points after each round' : mode === 'gap' ? 'Gap to the leader after each round' : 'Championship position after each round'}
          </h2>
        </div>
        <div role="group" aria-label="Chart view" className="inline-flex rounded-full p-1 ring-1 ring-[color:var(--bc-rule-strong)]">
          {MODES.map((md) => (
            <button
              key={md.id}
              type="button"
              aria-pressed={mode === md.id}
              onClick={() => setMode(md.id)}
              className={cn('min-h-11 whitespace-nowrap rounded-full px-3.5 text-[0.85rem] font-semibold transition-colors sm:px-4', mode === md.id ? 'bg-[color:var(--bc-white)] text-[color:var(--bc-night)]' : 'text-[color:var(--bc-silver)] hover:text-white')}
            >
              {md.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className="relative mt-6 w-full touch-pan-y select-none" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${yName} of the ${subject} after each of ${n} rounds. After round ${progression.rounds[index]!.round}: ${tipRows.slice(0, 5).map((t) => `${nameOf(t.id)} ${fmtV(t.v!)}`).join(', ')}.`}
            tabIndex={0}
            onKeyDown={onKey}
            className="block overflow-visible focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--bc-white)]"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={0} y={0} height={height} width={clipW + pad.left} style={{ transition: drawn && !playing && index >= lastIndex ? 'width 1.2s cubic-bezier(0.22,1,0.36,1)' : playing ? `width ${0.6}s linear` : 'none' }} />
              </clipPath>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={pad.left + iw} y1={y(t)} y2={y(t)} stroke="rgb(255 255 255 / 0.07)" />
                <text x={pad.left - 10} y={y(t) + 4} textAnchor="end" className="fill-[color:var(--bc-titanium)] font-[family-name:var(--font-timing)] text-[11px]">{mode === 'position' ? `P${t}` : fmtPoints(t)}</text>
              </g>
            ))}
            {progression.rounds.map((r, i) => (i === n - 1 || (i % tickEvery === 0 && n - 1 - i >= Math.max(1, Math.ceil(tickEvery / 2)))) && (
              <text key={r.round} x={x(i)} y={height - 12} textAnchor="middle" className="fill-[color:var(--bc-titanium)] font-[family-name:var(--font-timing)] text-[11px]">R{r.round}</text>
            ))}
            {/* Context lines */}
            <g opacity={0.9}>
              {rows.filter((r) => !highlighted.includes(r.id)).map((r) => (
                <path key={r.id} d={path(r.id)} fill="none" stroke="rgb(255 255 255 / 0.13)" strokeWidth={1} strokeLinejoin="round" />
              ))}
            </g>
            {/* The full season as a faint trace while scrubbing */}
            {index < lastIndex && highlighted.map((id) => (
              <path key={`t-${id}`} d={path(id)} fill="none" stroke={colourOf(id)} strokeOpacity={0.22} strokeWidth={1.25} strokeDasharray={dashOf(id)} strokeLinejoin="round" />
            ))}
            <g clipPath={`url(#${clipId})`}>
              {highlighted.filter((id) => id !== selected).map((id) => (
                <path key={id} d={path(id)} fill="none" stroke={colourOf(id)} strokeOpacity={selected ? 0.75 : 1} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dashOf(id)} />
              ))}
              {selected && (
                <>
                  <path d={path(selected)} fill="none" stroke={colourOf(selected)} strokeOpacity={0.22} strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
                  <path d={path(selected)} fill="none" stroke={colourOf(selected)} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
            </g>
            {/* Round rule */}
            <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + ih} stroke={hover == null ? 'var(--bc-red)' : 'rgb(255 255 255 / 0.5)'} strokeWidth={hover == null ? 1.5 : 1} strokeDasharray={hover == null ? undefined : '3 3'} />
            {drawn && highlighted.map((id) => {
              const v = value(id, active);
              return v == null ? null : <circle key={id} cx={x(active)} cy={y(v)} r={id === selected ? 5 : 3.5} fill={colourOf(id)} stroke="var(--bc-carbon)" strokeWidth={2} />;
            })}
            {!narrow && labels.map((l) => (
              <g key={l.id}>
                <line x1={pad.left + iw + 6} x2={pad.left + iw + 24} y1={l.y} y2={l.y} stroke={colourOf(l.id)} strokeWidth={l.id === selected ? 3 : 1.9} strokeLinecap="round" strokeDasharray={l.id === selected ? undefined : dashOf(l.id)} />
                <text x={pad.left + iw + 30} y={l.y + 4} className={cn('text-[13px]', l.id === selected ? 'fill-[color:var(--bc-white)] font-semibold' : 'fill-[color:var(--bc-silver)]')}>
                  {nameOf(l.id)} <tspan className="fill-[color:var(--bc-titanium)] font-[family-name:var(--font-timing)] text-[12px]">{fmtV(l.v)}</tspan>
                </text>
              </g>
            ))}
            <rect
              x={pad.left}
              y={pad.top}
              width={iw}
              height={ih}
              fill="transparent"
              onPointerMove={(e) => { if (e.pointerType === 'mouse') setHover(idxAt(e.clientX, e.currentTarget.getBoundingClientRect())); }}
              onPointerLeave={() => setHover(null)}
              onPointerDown={(e) => onIndex(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
              className="cursor-crosshair"
            />
          </svg>
        )}
        {hover != null && width > 0 && (
          <div className="pointer-events-none absolute top-2 z-[1] min-w-[11rem] rounded-[12px] bg-[color:var(--bc-carbon-3)] p-3 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)] ring-1 ring-[color:var(--bc-rule-strong)]" style={tipLeft ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}>
            <p className="text-[0.78rem] font-semibold text-[color:var(--bc-white)]"><span className="bc-mono">R{progression.rounds[hover]!.round}</span> · {progression.rounds[hover]!.name}</p>
            <ul className="mt-2 space-y-1">
              {tipRows.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 text-[0.78rem] text-[color:var(--bc-silver)]">
                  <span className="flex items-center gap-2"><span aria-hidden className="h-3 w-[3px] rounded-full" style={{ background: colourOf(t.id) }} /><span className={t.id === selected ? 'font-semibold text-white' : undefined}>{nameOf(t.id)}</span></span>
                  <span className="bc-mono text-[color:var(--bc-white)]">{fmtV(t.v!)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Phones: the end labels become a legend under the chart. */}
      {narrow && (
        <ul aria-hidden className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
          {labels.map((l) => (
            <li key={l.id} className="flex min-w-0 items-center gap-2 text-[0.8rem]">
              <LineSwatch colour={colourOf(l.id)} dash={l.id === selected ? undefined : dashOf(l.id)} bold={l.id === selected} />
              <span className={cn('min-w-0 [overflow-wrap:anywhere]', l.id === selected ? 'font-semibold text-white' : 'text-[color:var(--bc-silver)]')}>{nameOf(l.id)}</span>
              <span className="bc-mono text-[color:var(--bc-titanium)]">{fmtV(l.v)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Highlight on the chart">
        <span aria-hidden className="bc-label mr-2 text-[color:var(--bc-titanium)]">Highlight</span>
        {rows.slice(0, 5).map((r, i) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={selected === r.id}
            onClick={() => onSelect(r.id)}
            className={cn('inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[0.85rem] font-semibold ring-1 transition-colors', selected === r.id ? 'bg-white/[0.08] text-white ring-white/40' : 'text-[color:var(--bc-silver)] ring-[color:var(--bc-rule-strong)] hover:text-white')}
          >
            <LineSwatch colour={colourOf(r.id)} dash={dashFor(i)} bold={selected === r.id} />
            {r.last}
          </button>
        ))}
      </div>

      <details className="group/details mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-[0.88rem] font-semibold text-[color:var(--bc-silver)] hover:text-white [&::-webkit-details-marker]:hidden">
          <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform duration-200 group-open/details:rotate-90 motion-reduce:transition-none" fill="currentColor"><path d="M3 1.5 9 6l-6 4.5z" /></svg>
          <span className="group-open/details:hidden">Show the chart as a table</span>
          <span className="hidden group-open/details:inline">Hide the table</span>
        </summary>
        <div className="mt-3 max-w-full overflow-x-auto rounded-[12px] ring-1 ring-[color:var(--bc-rule)]" role="region" aria-label={`${yName} by round`} tabIndex={0} data-scroll-hint="">
          {/* Phones scroll the table sideways: say so instead of hiding the last drivers at the frame edge. */}
          <p aria-hidden className="sticky left-0 flex items-center gap-2 px-3 pt-2 text-[0.8125rem] text-[color:var(--bc-titanium)] sm:hidden">
            <span className="inline-block h-px w-5 bg-current" />
            Swipe the table sideways for every driver
          </p>
          <table className="border-collapse text-[0.85rem]">
            <thead>
              <tr>
                <th scope="col" className="bc-label sticky left-0 bg-[color:var(--bc-carbon-2)] px-3 py-2 text-left text-[color:var(--bc-titanium)]">Round</th>
                {highlighted.map((id) => <th key={id} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold">{nameOf(id)}</th>)}
              </tr>
            </thead>
            <tbody>
              {progression.rounds.map((r, i) => (
                <tr key={r.round} className="border-t border-[color:var(--bc-rule)]">
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-[color:var(--bc-carbon-2)] px-3 py-1.5 text-left font-normal text-[color:var(--bc-silver)]"><span className="bc-mono">R{r.round}</span> · {r.name}</th>
                  {highlighted.map((id) => { const v = value(id, i); return <td key={id} className="bc-mono px-3 py-1.5 text-right">{v == null ? '–' : fmtV(v)}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function LineSwatch({ colour, dash, bold }: { colour: string; dash?: string; bold?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 26 6" className="h-1.5 w-[26px] shrink-0 overflow-visible">
      <line x1="1" x2="25" y1="3" y2="3" stroke={colour} strokeWidth={bold ? 3 : 2} strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}
