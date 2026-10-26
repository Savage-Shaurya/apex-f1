'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@apex/ui';
import { Label } from '@/components/ds';
import { dashFor } from '@/components/results/StandingsBoard';
import { lapsRun, type LapStory } from './lap-story';

/* ---------------------------------------------------------------------------
 * The race as a bump chart: running order at the end of every lap (Jolpica
 * lap timings). Focus + context, as on the championship chart: the podium
 * is named with its own line patterns, the driver the reader follows is the
 * one red line (red = selected), everyone else is faint context. Pit stops
 * of the followed driver are ticks on its line. Arrow keys move a lap cursor
 * whose read-out lists the named drivers' positions on that lap; a table
 * gives the same data without the chart.
 * ------------------------------------------------------------------------- */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function LapChart({ story, initialFollow }: { story: LapStory; /** Driver followed first (default: P4, the first car off the podium). */ initialFollow?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const podium = story.drivers.slice(0, 3).map((d) => d.id);
  const [followed, setFollowed] = useState<string>(initialFollow ?? story.drivers[3]?.id ?? story.drivers[0]!.id);
  const [cursor, setCursor] = useState<number>(story.laps);
  const [hover, setHover] = useState<number | null>(null);
  // What assistive tech hears: only the lap chosen by keyboard or click, after the keys rest (R3-A11Y-4).
  const [announced, setAnnounced] = useState('');
  const settled = useRef<number | null>(null);
  const selectId = useId();

  const narrow = width > 0 && width < 640;
  const pad = narrow ? { top: 14, right: 14, bottom: 34, left: 34 } : { top: 16, right: 150, bottom: 36, left: 44 };
  const height = narrow ? 340 : Math.min(560, 140 + story.field * 20);
  const iw = Math.max(1, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;
  // x: lap 0 (grid) to the last lap; y: P1 at the top.
  const x = (lap: number) => pad.left + (lap / Math.max(1, story.laps)) * iw;
  const y = (pos: number) => pad.top + ((pos - 1) / Math.max(1, story.field - 1)) * ih;

  const byId = useMemo(() => new Map(story.drivers.map((d) => [d.id, d])), [story.drivers]);
  const named = [...podium, ...(podium.includes(followed) ? [] : [followed])];
  const dashOf = (id: string) => { const i = podium.indexOf(id); return i >= 0 ? dashFor(i) : undefined; };

  /** Path of one driver: grid slot, then each lap; a missing lap breaks the line. */
  const path = useCallback((id: string) => {
    const d = byId.get(id)!;
    let out = '';
    let pen = false;
    if (d.grid != null) { out += `M${x(0).toFixed(1)} ${y(d.grid === 0 ? story.field : d.grid).toFixed(1)}`; pen = true; }
    d.positions.forEach((p, i) => {
      if (p == null) { pen = false; return; }
      out += `${pen ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(p).toFixed(1)}`;
      pen = true;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, width, story.field, story.laps]);

  const active = hover ?? cursor;
  const posAt = (id: string, lap: number) => {
    const d = byId.get(id)!;
    if (lap === 0) return d.grid == null ? null : d.grid === 0 ? null : d.grid;
    return d.positions[lap - 1] ?? null;
  };

  const onMove = useCallback((e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.max(0, Math.min(story.laps, Math.round(rel * story.laps))));
  }, [story.laps]);
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); setCursor((c) => Math.min(story.laps, c + step)); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); setCursor((c) => Math.max(0, c - step)); }
    if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    if (e.key === 'End') { e.preventDefault(); setCursor(story.laps); }
  };

  // End labels at each named driver's last lap run, nudged apart (min 16px).
  const labels = named
    .map((id) => { const d = byId.get(id)!; const run = lapsRun(d); return { id, y: y(run ? d.positions[run - 1]! : d.grid || story.field), out: run < story.laps }; })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i]!.y - labels[i - 1]!.y < 16) labels[i]!.y = labels[i - 1]!.y + 16;

  const lapTicks = Array.from({ length: Math.floor(story.laps / 10) }, (_, i) => (i + 1) * 10).filter((l) => l <= story.laps - 4);
  const posTicks = [1, 5, 10, 15, 20].filter((p) => p <= story.field);
  const followedDriver = byId.get(followed)!;
  const readout = named.map((id) => ({ id, pos: posAt(id, active) })).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
  const tableLaps = [1, ...lapTicks, story.laps].filter((l, i, all) => all.indexOf(l) === i);
  const cursorText = `${cursor === 0 ? 'Grid' : `Lap ${cursor} of ${story.laps}`}: ${named.map((id) => ({ id, pos: posAt(id, cursor) })).sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)).map((r) => `${r.pos != null ? `P${r.pos}` : cursor === 0 ? 'pit lane' : 'out'} ${byId.get(r.id)!.last}`).join(', ')}`;
  const firstCursor = useRef(true);
  useEffect(() => {
    if (firstCursor.current) { firstCursor.current = false; return; }
    if (settled.current != null) window.clearTimeout(settled.current);
    settled.current = window.setTimeout(() => setAnnounced(cursorText), 400);
    return () => { if (settled.current != null) window.clearTimeout(settled.current); };
  }, [cursorText]);

  return (
    <figure className="min-w-0">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <figcaption className="max-w-[60ch] font-text text-small text-fg-2">
          Running order at the end of every lap; each line starts at its grid slot. The podium is named with its own line patterns; red follows the driver you choose.
        </figcaption>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={selectId} className="font-text text-label uppercase text-fg-3">Follow a driver</label>
          <select
            id={selectId}
            value={followed}
            onChange={(e) => setFollowed(e.target.value)}
            className="min-h-11 min-w-[14rem] cursor-pointer bg-tone-raised px-3 font-text text-ui text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)]"
          >
            {story.drivers.map((d) => (
              <option key={d.id} value={d.id}>{/^\d+$/.test(d.positionText) ? `P${d.positionText}` : 'Not classified'} · {d.first} {d.last}</option>
            ))}
          </select>
        </div>
      </div>

      <div ref={ref} className="relative mt-6 w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Lap chart, ${story.laps} laps. Use the arrow keys to move the lap cursor (Shift for ten laps, Home for the grid, End for the finish).`}
            tabIndex={0}
            onKeyDown={onKey}
            className="block overflow-visible focus-visible:outline-offset-4"
          >
            {posTicks.map((p) => (
              <g key={p}>
                <line x1={pad.left} x2={pad.left + iw} y1={y(p)} y2={y(p)} stroke="var(--rule)" />
                <text x={pad.left - 8} y={y(p) + 4} textAnchor="end" className="fill-[var(--fg-3)] font-text text-[12px] tabular-nums">P{p}</text>
              </g>
            ))}
            {[0, ...lapTicks, story.laps].map((l) => (
              <text key={l} x={x(l)} y={height - 12} textAnchor="middle" className="fill-[var(--fg-3)] font-text text-[12px] tabular-nums">{l === 0 ? 'Grid' : l}</text>
            ))}
            {!narrow && <text x={pad.left + iw} y={height} textAnchor="end" className="fill-[var(--fg-3)] font-text text-[12px]">Lap</text>}
            {story.drivers.filter((d) => !named.includes(d.id)).map((d) => (
              <path key={d.id} d={path(d.id)} fill="none" stroke="var(--color-ink-faint)" strokeOpacity={0.4} strokeWidth={1} />
            ))}
            {podium.filter((id) => id !== followed).map((id) => (
              <path key={id} d={path(id)} fill="none" stroke="var(--fg)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dashOf(id)} />
            ))}
            <path d={path(followed)} fill="none" stroke="var(--color-brand-red)" strokeWidth={2.5} strokeLinejoin="round" />
            {followedDriver.pitLaps.map((lap) => {
              const p = followedDriver.positions[lap - 1];
              return p == null ? null : <line key={lap} x1={x(lap)} x2={x(lap)} y1={y(p) - 7} y2={y(p) + 7} stroke="var(--color-brand-red)" strokeWidth={2} />;
            })}
            <line x1={x(active)} x2={x(active)} y1={pad.top - 6} y2={pad.top + ih + 6} stroke={hover == null ? 'var(--fg-2)' : 'var(--fg-3)'} strokeWidth={1} strokeDasharray="3 3" />
            {named.map((id) => {
              const p = posAt(id, active);
              return p == null ? null : <circle key={id} cx={x(active)} cy={y(p)} r={id === followed ? 4.5 : 3.5} fill={id === followed ? 'var(--color-brand-red)' : 'var(--fg)'} stroke="var(--bg)" strokeWidth={2} />;
            })}
            {!narrow && labels.map((l) => (
              <text key={l.id} x={pad.left + iw + 12} y={l.y + 4} className={cn('font-text text-[13px]', l.id === followed ? 'fill-[var(--accent-text)] font-[650]' : 'fill-[var(--fg)]')}>
                {byId.get(l.id)!.last}
                <tspan className="fill-[var(--fg-3)]">{l.out ? ' · out' : ` · P${byId.get(l.id)!.positionText}`}</tspan>
              </text>
            ))}
            <rect x={pad.left} y={pad.top} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={() => hover != null && setCursor(hover)} className="cursor-crosshair" />
          </svg>
        )}
      </div>

      {/* Read-out for the lap under the pointer or keyboard cursor: visual only; the polite region below speaks keyboard and click choices. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announced}</p>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Label tone="subtle">{active === 0 ? 'Grid' : `Lap ${active} of ${story.laps}`}</Label>
        {readout.map((r) => (
          <span key={r.id} className="inline-flex items-baseline gap-2 font-text text-small">
            <span className={cn('font-[650] tabular-nums', r.id === followed ? 'text-accent' : 'text-fg')}>{r.pos != null ? `P${r.pos}` : active === 0 ? (byId.get(r.id)!.grid === 0 && lapsRun(byId.get(r.id)!) > 0 ? 'Pit lane' : 'No grid slot') : 'Out'}</span>
            <span className="text-fg-2">{byId.get(r.id)!.last}</span>
          </span>
        ))}
        {followedDriver.pitLaps.length > 0 && (
          <span className="font-text text-small text-fg-3">{followedDriver.last} pitted on lap {followedDriver.pitLaps.join(', ')} (red ticks)</span>
        )}
      </div>

      <details className="group/details mt-4">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-text text-ui font-[650] text-fg-2 hover:text-fg [&::-webkit-details-marker]:hidden">
          <svg aria-hidden viewBox="0 0 12 12" className="size-3 transition-transform duration-[var(--duration-fast)] group-open/details:rotate-90 motion-reduce:transition-none" fill="currentColor"><path d="M3 1.5 9 6l-6 4.5z" /></svg>
          <span className="group-open/details:hidden">Show positions as a table</span>
          <span className="hidden group-open/details:inline">Hide the table</span>
        </summary>
        {/* Phones: one card per driver with the laps wrapping, so nothing scrolls sideways. */}
        <ol aria-label="Positions on the grid and at every tenth lap" className="mt-3 space-y-2 sm:hidden">
          {story.drivers.map((d) => (
            <li key={d.id} className="border-t border-rule pt-2">
              <p className="font-text text-small text-fg">{d.first} <span className="font-[650]">{d.last}</span></p>
              <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-text text-small tabular-nums">
                <div className="flex gap-1.5"><dt className="text-fg-3">Grid</dt><dd className="text-fg-2">{d.grid == null ? '–' : d.grid === 0 ? 'Pit lane' : d.grid}</dd></div>
                {tableLaps.map((l) => <div key={l} className="flex gap-1.5"><dt className="text-fg-3">L{l}</dt><dd className="text-fg">{d.positions[l - 1] ?? '–'}</dd></div>)}
              </dl>
            </li>
          ))}
        </ol>
        <div className="mt-3 hidden max-w-full overflow-x-auto sm:block" role="region" aria-label="Positions on the grid and at every tenth lap" tabIndex={0}>
          <table className="border-collapse font-text text-small tabular-nums">
            <caption className="sr-only">Running order by driver: grid slot, lap 1, every tenth lap and the last lap</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 bg-tone pr-4 text-left"><Label>Driver</Label></th>
                <th scope="col" className="px-3 text-right"><Label>Grid</Label></th>
                {tableLaps.map((l) => <th key={l} scope="col" className="px-3 text-right"><Label>Lap {l}</Label></th>)}
              </tr>
            </thead>
            <tbody>
              {story.drivers.map((d) => (
                <tr key={d.id} className="border-t border-rule">
                  <th scope="row" className="sticky left-0 whitespace-nowrap bg-tone py-1.5 pr-4 text-left font-normal text-fg">{d.first} <span className="font-[650]">{d.last}</span></th>
                  <td className="px-3 py-1.5 text-right text-fg-2">{d.grid == null ? '–' : d.grid === 0 ? (lapsRun(d) > 0 ? 'Pit lane' : '–') : d.grid}</td>
                  {tableLaps.map((l) => <td key={l} className="px-3 py-1.5 text-right">{d.positions[l - 1] ?? <span className="text-fg-3">–</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
