'use client';

import { useEffect, useRef, useState } from 'react';
import { cancelFrame, requestFrame } from './rb/frame';
import { usePrefersReducedMotion } from '@/components/motion/preferences';
import { useLiteDevice } from './device';

/**
 * The real circuit outline with a streak of light lapping it, like a car's
 * light trail in a long exposure. The streak is drawn with stroke dashes on
 * the site's single clock (GSAP's ticker, via ./rb/frame), runs only while on screen, and is a
 * still trace under reduced motion. It is decoration, not timing: it claims
 * no lap time.
 */
export function CircuitStreak({ d, width, height, label }: { d: string; width: number; height: number; label: string }) {
  const host = useRef<SVGSVGElement>(null);
  const streak = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);
  const [visible, setVisible] = useState(false);
  const reduced = usePrefersReducedMotion();
  const lite = useLiteDevice();

  useEffect(() => {
    if (streak.current) setLength(streak.current.getTotalLength());
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [d]);

  useEffect(() => {
    if (!visible || reduced || lite || !length) return;
    let id = 0;
    const step = (now: number) => {
      const offset = -(((now / 1000) * 0.085) % 1) * length;
      streak.current?.setAttribute('stroke-dashoffset', String(offset));
      glow.current?.setAttribute('stroke-dashoffset', String(offset));
      id = requestFrame(step, 1000 / 30 - 3);
    };
    id = requestFrame(step);
    return () => cancelFrame(id);
  }, [visible, reduced, lite, length]);

  const pad = Math.max(width, height) * 0.06;
  const dash = length ? `${length * 0.14} ${length * 0.86}` : undefined;
  return (
    <svg ref={host} viewBox={`${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`} className="h-full w-full" role="img" aria-label={label}>
      <defs>
        <linearGradient id="bc-streak" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#ff4f47" />
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke="rgb(255 255 255 / 0.10)" strokeWidth={Math.max(width, height) * 0.03} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="rgb(255 255 255 / 0.32)" strokeWidth={Math.max(width, height) * 0.006} strokeLinejoin="round" />
      <path ref={glow} d={d} fill="none" stroke="rgb(255 79 71 / 0.22)" strokeWidth={Math.max(width, height) * 0.028} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeDashoffset={0} opacity={length ? 1 : 0} />
      <path ref={streak} d={d} fill="none" stroke="url(#bc-streak)" strokeWidth={Math.max(width, height) * 0.009} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} strokeDashoffset={0} opacity={length ? 1 : 0} />
    </svg>
  );
}
