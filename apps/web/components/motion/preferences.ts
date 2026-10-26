'use client';

import { useSyncExternalStore } from 'react';

function subscribeQuery(query: string) {
  return (changed: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', changed);
    return () => mq.removeEventListener('change', changed);
  };
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const COARSE = '(pointer: coarse)';
/** Touch phones: WebGL mounts there cost 200-350 ms of main thread mid-scroll (three/R3F eval + shader compile, measured at 6x CPU). */
const PHONE = '(pointer: coarse) and (max-width: 767px)';
const subscribeReduced = subscribeQuery(REDUCED);
const subscribeCoarse = subscribeQuery(COARSE);

/** Live reduced-motion preference. Server render assumes motion is allowed but nothing waits on it. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);
}

/** Live coarse-pointer state (touch first). */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);
}

type NavigatorWithHints = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

/**
 * Whether a heavy optional effect (WebGL scene, video loop) should run:
 * not under reduced motion, not with Save-Data, not on very low-memory devices,
 * and not on touch phones (the static fallback shows the same subject there).
 * Read once on the client; callers keep a static fallback for `false`.
 */
export function canRunHeavyEffects(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia(REDUCED).matches) return false;
  if (window.matchMedia(PHONE).matches) return false;
  const nav = navigator as NavigatorWithHints;
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) return false;
  return true;
}
