'use client';

import { useEffect, useRef } from 'react';

/**
 * Counts up to `value` the first time it scrolls into view. The server HTML
 * carries the final value, so no-JS, crawlers and reduced motion always see
 * the real number; the animation only rewinds it once the client is ready.
 */
export function CountUp({
  value,
  duration = 1.4,
  decimals = 0,
  className,
  prefix = '',
  suffix = '',
}: {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const format = (n: number) => `${prefix}${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(value)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9 && rect.bottom > 0) return; // already visible: leave it
    el.textContent = format(0);
    let raf = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / (duration * 1000));
        const eased = 1 - Math.pow(1 - p, 4);
        el.textContent = format(value * eased);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- format is derived from the listed props.
  }, [value, duration, decimals, prefix, suffix]);

  return <span ref={ref} className={`tabular ${className ?? ''}`}>{format(value)}</span>;
}
