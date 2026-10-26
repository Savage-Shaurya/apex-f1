'use client';

import { useRef, type ReactNode } from 'react';

/**
 * A sideways rail that brings a keyboard-focused card fully into view, with
 * room for its focus ring (scroll padding on the rail), instead of leaving
 * it half off screen (R3-A11Y-2, R3-A11Y-6). Pointer and wheel behaviour is
 * the browser's own; reduced motion jumps instead of gliding.
 */
export function FocusRail({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  const ref = useRef<HTMLUListElement>(null);
  return (
    <ul
      ref={ref}
      aria-label={label}
      className={className}
      onFocus={(event) => {
        const rail = ref.current;
        const item = (event.target as HTMLElement).closest('li');
        if (!rail || !item || rail.scrollWidth <= rail.clientWidth) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const pad = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0;
        const railBox = rail.getBoundingClientRect();
        const box = item.getBoundingClientRect();
        let delta = 0;
        if (box.left < railBox.left + pad) delta = box.left - railBox.left - pad;
        else if (box.right > railBox.right - pad) delta = box.right - railBox.right + pad;
        if (delta) rail.scrollBy({ left: delta, behavior: reduce ? 'auto' : 'smooth' });
      }}
    >
      {children}
    </ul>
  );
}
