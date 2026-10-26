'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { usePrefersReducedMotion } from '@/components/motion/preferences';
import { useLiteDevice } from './device';
import {
  LAP_MS, PATH_UNITS, START_HEAD, TAIL,
  advanceClock, cometLayers, dashAt, fitViewBox, lapHead, pathPoints, pointsBounds, startMarker, traceMode,
} from './circuit-trace';

const LAYERS = cometLayers();
const GLOW = [
  { length: TAIL * PATH_UNITS * 0.45, width: 15, opacity: 0.14 },
  { length: TAIL * PATH_UNITS * 0.3, width: 9, opacity: 0.22 },
];
const DOT = 0.01;
/** Lite devices (touch-first, few cores, Save-Data) step the trace at ~30 fps; others every tick. */
const LITE_GAP_MS = 1000 / 30 - 2;

/**
 * The real circuit outline (bacinger/f1-circuits geometry) lapped by a comet:
 * a white head with a red halo and a tail fading through brand red to
 * transparent over ~15% of the lap, in the geometry's race direction from the
 * start/finish line. It runs on the site's single clock (GSAP's ticker), only
 * while on screen and the tab is visible, and is a still full-lap trace under
 * reduced motion. It is decoration, not timing: it claims no lap time.
 */
export function CircuitStreak({ d, width, height, label }: { d: string; width: number; height: number; label: string }) {
  const host = useRef<SVGSVGElement>(null);
  const comet = useRef<SVGGElement>(null);
  const elapsed = useRef(0);
  const [onScreen, setOnScreen] = useState(false);
  const mode = traceMode(usePrefersReducedMotion());
  const lite = useLiteDevice();

  const geo = useMemo(() => {
    const pts = pathPoints(d);
    const box = pointsBounds(pts) ?? { minX: 0, minY: 0, maxX: width, maxY: height };
    // Stroke widths are in outline units, scaled to the outline's longest side (geometry is normalised to 1000).
    const u = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) / 1000;
    return { u, viewBox: fitViewBox(box, 16 * u), marker: startMarker(pts) };
  }, [d, width, height]);
  const { u, viewBox, marker } = geo;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(Boolean(e?.isIntersecting)), { rootMargin: '80px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== 'lap' || !onScreen) return;
    const paths = Array.from(comet.current?.querySelectorAll<SVGPathElement>('path[data-len]') ?? []);
    const lens = paths.map((p) => Number(p.dataset.len));
    let since = 0;
    const tick = (_time: number, deltaMs: number) => {
      elapsed.current = advanceClock(elapsed.current, deltaMs);
      since += deltaMs;
      if (lite && since < LITE_GAP_MS) return;
      since = 0;
      const head = lapHead(elapsed.current, LAP_MS, START_HEAD);
      for (let i = 0; i < paths.length; i++) paths[i]!.setAttribute('stroke-dashoffset', String(dashAt(head, lens[i]!).dashoffset));
    };
    let running = false;
    const sync = () => {
      const want = document.visibilityState === 'visible';
      if (want && !running) gsap.ticker.add(tick);
      if (!want && running) gsap.ticker.remove(tick);
      running = want;
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      gsap.ticker.remove(tick);
    };
  }, [mode, onScreen, lite]);

  // First paint (and the server render) shows the comet just past the line; the ticker moves it from there.
  // The props never change, so React never resets the offsets the ticker writes.
  const dash = (len: number) => {
    const { dasharray, dashoffset } = dashAt(START_HEAD, len);
    return { 'data-len': len, pathLength: PATH_UNITS, strokeDasharray: dasharray, strokeDashoffset: dashoffset };
  };

  const flag = marker && (
      <g transform={`translate(${marker.x} ${marker.y}) rotate(${marker.angle})`}>
        <rect x={-4 * u} y={-15 * u} width={8 * u} height={30 * u} fill="#f4f5f7" />
        {[0, 1].flatMap((col) => [0, 1, 2, 3, 4, 5].filter((row) => (row + col) % 2 === 0).map((row) => (
          <rect key={`${col}-${row}`} x={(-4 + col * 4) * u} y={(-15 + row * 5) * u} width={4 * u} height={5 * u} fill="#050506" />
        )))}
      </g>
    );

  return (
    <svg ref={host} viewBox={viewBox} className="h-full w-full" role="img" aria-label={label} fill="none" strokeLinejoin="round">
      {/* Track: dark surface with faint edges and a faint centre line. */}
      <path d={d} stroke="rgb(255 255 255 / 0.19)" strokeWidth={22 * u} />
      <path d={d} stroke="#141418" strokeWidth={19 * u} />
      <path d={d} stroke="rgb(255 255 255 / 0.16)" strokeWidth={1.2 * u} />

      {/* Start/finish line: under the moving comet, above the still trace. */}
      {mode === 'lap' && flag}

      {mode === 'static' ? (
        <>
          <path d={d} stroke="#ff4f47" strokeWidth={3 * u} opacity={0.9} />
          {flag}
        </>
      ) : (
        <g ref={comet} strokeLinecap="butt">
          {GLOW.map((g) => <path key={`g${g.length}`} d={d} {...dash(g.length)} stroke="#ff4f47" strokeWidth={g.width * u} strokeLinecap="round" opacity={g.opacity} />)}
          {LAYERS.map((l) => <path key={l.length} d={d} {...dash(l.length)} stroke={l.color} strokeWidth={7.5 * l.width * u} opacity={l.opacity} />)}
          <path d={d} {...dash(DOT)} stroke="#e10600" strokeWidth={26 * u} strokeLinecap="round" opacity={0.28} />
          <path d={d} {...dash(DOT)} stroke="#ff4f47" strokeWidth={15 * u} strokeLinecap="round" opacity={0.5} />
          <path d={d} {...dash(DOT)} stroke="#ffffff" strokeWidth={9.5 * u} strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}
