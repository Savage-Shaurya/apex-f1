import type { CSSProperties } from 'react';
import { StudioFigure } from '@/components/brand-c/StudioFigure';
import { cutoutAt } from '@/components/brand-c/data';
import type { ClassifiedRow } from './sheet-model';

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/** Step geometry in % of the stage, the same podium as the home hero (2 | 1 | 3, contiguous faces). */
const GEO = {
  1: { left: 36, width: 28, step: 15, fig: 74, z: 3, strike: 560, rise: 200 },
  2: { left: 9, width: 27, step: 10.5, fig: 68, z: 2, strike: 420, rise: 120 },
  3: { left: 64, width: 27, step: 7.5, fig: 66, z: 1, strike: 320, rise: 280 },
} as const;
const FLOOR = 9;

/**
 * The top three standing on the night podium: the real full-body cut-outs
 * lit like a studio shoot (StudioFigure), each on their own carbon step, the
 * floodlight pooled on the floor. Wide screens only; the caller renders the
 * ranked cards for phones and whenever a cut-out is missing.
 */
export function NightPodium({ rows, cutouts, label }: { rows: ClassifiedRow[]; cutouts: Map<number, string>; label: string }) {
  const placed = rows.filter((r): r is ClassifiedRow & { position: 1 | 2 | 3 } => r.position === 1 || r.position === 2 || r.position === 3);
  return (
    <div className="relative mx-auto aspect-[16/8.2] w-full max-w-[72rem]" role="img" aria-label={label}>
      <div aria-hidden className="pointer-events-none absolute inset-x-[10%] top-[-12%] h-[80%] bg-[radial-gradient(ellipse_40%_50%_at_50%_45%,rgb(233_240_255/0.16),transparent_72%)]" />
      {/* gloss floor in perspective */}
      <div aria-hidden className="pointer-events-none absolute inset-x-[-20%] bottom-0 overflow-hidden [perspective:620px]" style={{ height: `${FLOOR + 8}%` }}>
        <div className="absolute inset-x-0 bottom-[-40%] top-0 origin-top [transform:rotateX(64deg)] [background-image:repeating-linear-gradient(90deg,rgb(255_255_255/0.07)_0_1px,transparent_1px_64px),repeating-linear-gradient(0deg,rgb(255_255_255/0.055)_0_1px,transparent_1px_64px)] [mask-image:radial-gradient(ellipse_60%_90%_at_50%_0%,#000,transparent_75%)]" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-[-10%]" style={{ bottom: `${FLOOR}%` }}>
        <div className="bc-in-horizon absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" style={d(0)} />
        <div className="absolute left-1/2 top-0 h-28 w-[70%] -translate-x-1/2 bg-[radial-gradient(ellipse_50%_60%_at_50%_0%,rgb(233_240_255/0.18),transparent_72%)]" />
      </div>
      {placed.map((row) => {
        const g = GEO[row.position];
        const src = cutouts.get(row.number) ?? null;
        return (
          <div key={row.number} aria-hidden className="absolute" style={{ left: `${g.left}%`, width: `${g.width}%`, bottom: `${FLOOR}%`, top: 0, zIndex: g.z }}>
            <div className="bc-step bc-in-step inset-x-0" style={{ height: `${(g.step / (100 - FLOOR)) * 100}%`, ...d(g.rise) }}>
              <span className="bc-display absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[clamp(1.2rem,2.4vw,2.4rem)] leading-none text-white/85">{row.position}</span>
            </div>
            <div className="bc-in-strike absolute left-1/2 -translate-x-1/2" style={{ bottom: `${(g.step / (100 - FLOOR)) * 100}%`, height: `${(g.fig / (100 - FLOOR)) * 100}%`, aspectRatio: '400 / 1150', ...d(g.strike) }}>
              <StudioFigure
                src={cutoutAt(src, row.position === 1 ? 540 : 400)}
                name=""
                team={row.driver.color ?? '#8d8f98'}
                dim={row.position === 1 ? 1 : 0.72}
                reflection={false}
                className="h-full"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
