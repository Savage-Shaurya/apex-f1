'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';

/**
 * Per-frame work on the site's single clock (GSAP's ticker, which also drives
 * ScrollTrigger over native scroll). The callback receives seconds since start and a
 * clamped delta; it pauses while the document is hidden and resumes without a
 * large elapsed-time jump. Pass `active=false` to detach (e.g. off-screen).
 */
export function useTicker(callback: (time: number, delta: number) => void, active = true) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);

  useEffect(() => {
    if (!active) return;
    let previous: number | null = null;
    const tick = (time: number) => {
      if (document.hidden) { previous = null; return; }
      const delta = previous === null ? 0 : Math.min(Math.max(time - previous, 0), 0.05);
      previous = time;
      saved.current(time, delta);
    };
    gsap.ticker.add(tick);
    return () => { gsap.ticker.remove(tick); };
  }, [active]);
}
