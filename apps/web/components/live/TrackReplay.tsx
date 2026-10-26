'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@apex/ui';
import { Button, Label, Timing } from '@/components/ds';
import { useTicker } from '@/components/motion/useTicker';
import { formatLapTime, pointAt, type TracePoint } from './sheet-model';

/**
 * The fastest lap drawn from its own recorded GPS, with an opt-in replay: one
 * dot travels the trace on the recorded timestamps (real speed or 4x) and the
 * lap clock counts the real elapsed time. Frames come from the site's single
 * clock (GSAP ticker via useTicker), which pauses when the tab is hidden.
 */
export function TrackReplay({
  points,
  width,
  height,
  sectors,
  lapTime,
  color,
  code,
  label,
}: {
  points: TracePoint[];
  width: number;
  height: number;
  sectors: Array<number | null>;
  lapTime: number;
  color: string;
  code: string;
  label: string;
}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 4>(4);
  const timeRef = useRef(0);

  const poly = useMemo(() => points.map((p) => `${p.x},${p.y}`).join(' '), [points]);
  // Sector boundaries: elapsed seconds at the end of S1 and S2, when published.
  const splits = useMemo(() => {
    const s1 = sectors[0];
    const s2 = sectors[1];
    return [s1 ?? null, s1 != null && s2 != null ? s1 + s2 : null];
  }, [sectors]);
  const splitPoints = splits.map((s) => (s == null ? null : points[pointAt(points, s)] ?? null));

  useTicker((_, delta) => {
    const next = Math.min(lapTime, timeRef.current + delta * speed);
    timeRef.current = next;
    setT(next);
    if (next >= lapTime) setPlaying(false);
  }, playing);

  const toggle = () => {
    if (playing) { setPlaying(false); return; }
    if (timeRef.current >= lapTime) { timeRef.current = 0; setT(0); }
    setPlaying(true);
  };
  const reset = () => { setPlaying(false); timeRef.current = 0; setT(0); };

  const idx = pointAt(points, t);
  const dot = t > 0 ? points[idx] : null;
  const start = points[0];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  // Labels sit beside their mark, flipping to the inner side near an edge so they never leave the frame.
  const side = (x: number) => (x / width > 0.7 ? '-translate-x-[calc(100%+0.75rem)]' : 'translate-x-3');
  const sectorDone = (i: number) => {
    const end = i === 0 ? splits[0] : i === 1 ? splits[1] : lapTime;
    return end != null && t >= end;
  };

  return (
    <div className="min-w-0">
      <div className="bcp-panel relative overflow-hidden p-[4%]">
        <div className="relative" style={{ aspectRatio: `${width} / ${height}` }}>
          <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" role="img" aria-label={label}>
            <polyline points={poly} fill="none" stroke="rgb(233 240 255 / 0.06)" strokeWidth={48} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={poly} fill="none" stroke="#1a1a1f" strokeWidth={24} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={poly} fill="none" stroke="#f4f4f5" strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />
            {splitPoints.map((p, i) => p && (
              <circle key={i} cx={p.x} cy={p.y} r={8} fill="#0b0b0c" stroke="#f4f4f5" strokeWidth={3} />
            ))}
            {start && <rect x={start.x - 10} y={start.y - 10} width={20} height={20} fill="#e10600" transform={`rotate(45 ${start.x} ${start.y})`} />}
            {dot && <circle cx={dot.x} cy={dot.y} r={13} fill={color} stroke="#0b0b0c" strokeWidth={4} />}
          </svg>
          {/* HTML labels keep their reading size at every width. */}
          {start && (
            <span aria-hidden className={`pointer-events-none absolute -translate-y-[170%] ${side(start.x)} whitespace-nowrap rounded bg-[#050506]/90 px-1.5 font-text text-caption font-[650] text-ink`} style={{ left: pct(start.x, width), top: pct(start.y, height) }}>
              Start
            </span>
          )}
          {splitPoints.map((p, i) => p && (
            <span key={i} aria-hidden className={`pointer-events-none absolute -translate-y-[170%] ${side(p.x)} rounded bg-[#050506]/90 px-1.5 font-text text-caption font-[650] text-ink`} style={{ left: pct(p.x, width), top: pct(p.y, height) }}>
              S{i + 2}
            </span>
          ))}
          {dot && (
            <span aria-hidden className={`pointer-events-none absolute translate-y-3 ${side(dot.x)} rounded bg-[#050506]/90 px-1.5 font-text text-caption font-[750] tracking-[0.04em] text-ink`} style={{ left: pct(dot.x, width), top: pct(dot.y, height) }}>
              {code}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Button variant="primary" leadingIcon={playing ? 'pause' : 'play'} onClick={toggle} aria-pressed={playing}>
          {playing ? 'Pause replay' : t > 0 && t < lapTime ? 'Resume replay' : 'Replay lap'}
        </Button>
        <div role="group" aria-label="Replay speed" className="flex">
          {([1, 4] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={cn('min-h-11 min-w-14 px-4 font-text text-ui font-[650] shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-colors', speed === s ? 'bg-white text-[color:var(--bc-night)]' : 'text-white hover:bg-white/10')}
            >
              {s === 1 ? 'Real time' : '4x'}
            </button>
          ))}
        </div>
        {t > 0 && <Button variant="ghost" onClick={reset} leadingIcon="refresh">Reset</Button>}
        <p className="flex items-baseline gap-2">
          <Label>Lap clock</Label>
          <Timing className="text-[1.25rem] text-fg">{formatLapTime(t) ?? '0.000'}</Timing>
        </p>
      </div>

      <ol className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-[14px] bg-[var(--rule)] shadow-[inset_0_0_0_1px_var(--rule)]" aria-label="Sector times">
        {sectors.map((s, i) => (
          <li key={i} className={cn('bg-tone p-3 transition-colors duration-[var(--duration-base)] sm:p-4', sectorDone(i) && t > 0 && 'bg-tone-raised shadow-[inset_0_2px_0_var(--color-brand-red)]')}>
            <Label as="p">Sector {i + 1}</Label>
            <p className="mt-1"><Timing className="text-fg">{formatLapTime(s) ?? 'Not published'}</Timing></p>
          </li>
        ))}
      </ol>
      <p className="mt-3 font-text text-caption text-fg-3">Replay of the car’s position on track, about four times a second.</p>
    </div>
  );
}
