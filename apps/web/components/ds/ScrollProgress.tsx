'use client';

import { useRef } from 'react';
import { cn } from '@apex/ui';
import { useScrollProgress } from '@/components/motion/useScrollProgress';

/**
 * Page scroll position as one 2px red line along the header's lower edge.
 * Read from ScrollTrigger (the single clock, no extra animation loop) and
 * written straight to the element's transform (scaleX), so scrolling never
 * re-renders React. It tracks position rather than animating, so it behaves
 * the same with reduced motion. Decorative: the page structure carries the
 * reading position for assistive tech.
 */
export function ScrollProgress({ className }: { className?: string }) {
  const line = useRef<HTMLSpanElement>(null);
  useScrollProgress((p) => {
    const el = line.current;
    if (el) el.style.transform = `scaleX(${Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0})`;
  });
  return (
    <span
      ref={line}
      aria-hidden
      data-scroll-progress=""
      className={cn('pointer-events-none block h-0.5 origin-left bg-brand-red', className)}
      style={{ transform: 'scaleX(0)' }}
    />
  );
}
