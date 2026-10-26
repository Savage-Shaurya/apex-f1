'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * The marquee's outer region. Marks itself `data-offscreen` while it is out of
 * the viewport or the tab is hidden, and globals.css pauses the CSS loop then:
 * a running CSS animation ticks the main thread's style engine every frame
 * (measured on the homepage: 60 style recalcs a second, about 12 ms/s at 1x
 * CPU, about 70 ms/s on a 6x-throttled phone) even when nobody can see it.
 */
export function MarqueeRegion({ className, style, label, paused, children }: { className: string; style: CSSProperties; label: string; paused: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = false;
    const apply = () => { if (inView && !document.hidden) delete el.dataset.offscreen; else el.dataset.offscreen = 'true'; };
    const io = new IntersectionObserver(([entry]) => { inView = Boolean(entry?.isIntersecting); apply(); });
    io.observe(el);
    document.addEventListener('visibilitychange', apply);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', apply); };
  }, []);
  return (
    <div ref={ref} role="region" aria-label={label} data-paused={paused || undefined} data-offscreen="true" className={className} style={style}>
      {children}
    </div>
  );
}
