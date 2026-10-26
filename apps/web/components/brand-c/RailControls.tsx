'use client';

import { useEffect } from 'react';

/**
 * Keyboard focus in a horizontal rail: bring the focused tile fully into view
 * (its start at the rail's scroll padding). Snapping is switched off while focus
 * is inside (globals.css), so the browser cannot pull the previous tile back
 * and leave the focused one half off-screen (round 3 a11y, R3-A11Y-6).
 */
function useRailFocus(railId: string) {
  useEffect(() => {
    const rail = document.getElementById(railId);
    if (!rail) return;
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target.matches(':focus-visible')) return;
      let tile = target;
      while (tile.parentElement && tile.parentElement !== rail) tile = tile.parentElement;
      const r = tile.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(rail).scrollPaddingInlineStart) || 0;
      if (r.left >= box.left + pad - 1 && r.right <= box.right + 1) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rail.scrollTo({ left: rail.scrollLeft + (r.left - box.left) - pad, behavior: reduced ? 'auto' : 'smooth' });
    };
    rail.addEventListener('focusin', onFocus);
    return () => rail.removeEventListener('focusin', onFocus);
  }, [railId]);
}

/** Focus-into-view for a rail that has no previous / next buttons. Renders nothing. */
export function RailFocus({ railId }: { railId: string }) {
  useRailFocus(railId);
  return null;
}

/** Previous / next for a horizontal rail, and an instant jump to the current tile on load (scroll position only, no layout change). */
export function RailControls({ railId }: { railId: string }) {
  useRailFocus(railId);
  useEffect(() => {
    const rail = document.getElementById(railId);
    const current = rail?.querySelector<HTMLElement>('[data-current]');
    if (!rail || !current) return;
    const prev = current.previousElementSibling as HTMLElement | null;
    const anchor = prev ?? current;
    const first = rail.firstElementChild as HTMLElement | null;
    rail.scrollLeft = Math.max(0, anchor.offsetLeft - (first?.offsetLeft ?? 0));
  }, [railId]);
  const go = (dir: number) => {
    const rail = document.getElementById(railId);
    if (!rail) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    rail.scrollBy({ left: dir * rail.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };
  const btn = 'grid size-11 place-items-center rounded-full text-white ring-1 ring-[color:var(--bc-rule-strong)] transition-colors hover:bg-white hover:text-[color:var(--bc-night)]';
  return (
    <div className="flex gap-2">
      <button type="button" className={btn} onClick={() => go(-1)} aria-label="Earlier rounds" aria-controls={railId}>
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button type="button" className={btn} onClick={() => go(1)} aria-label="Later rounds" aria-controls={railId}>
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}
