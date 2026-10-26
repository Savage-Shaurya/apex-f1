'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * The filter rail that sticks under the header on wide screens. It publishes
 * its own height as `--sticky-rail-h` while it is sticky, so content links
 * (`stickyRailScrollMargin` in FilterRail.tsx) keep a scroll margin that clears both the
 * header and the rail: a link reached with Shift+Tab is never hidden under
 * them (WCAG 2.4.11, audit A11Y-2). Promote to ds with FilterRail.
 */
export function StickyRail({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const sticky = getComputedStyle(el).position === 'sticky';
      root.style.setProperty('--sticky-rail-h', sticky ? `${Math.ceil(el.getBoundingClientRect().height)}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--sticky-rail-h');
    };
  }, []);
  return (
    <div ref={ref} className={cn('z-30 border-y border-white/[0.08] bg-[color:var(--bc-night,#050506)] lg:sticky lg:top-[var(--nav-offset)] transition-[top] duration-[var(--duration-slow)] ease-[var(--ease-out)]', className)}>
      {children}
    </div>
  );
}
