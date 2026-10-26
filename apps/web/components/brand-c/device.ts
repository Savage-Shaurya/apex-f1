'use client';

import { useSyncExternalStore } from 'react';

type Nav = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

/**
 * "Lite" devices get the static versions of ambient effects (CSS light instead
 * of WebGL, a still circuit trace): touch-first screens, 4 or fewer CPU cores,
 * 4 GB or less memory, Save-Data, or reduced motion. Server render assumes lite,
 * so nothing heavy is ever in the first paint.
 */
function compute(): boolean {
  const nav = navigator as Nav;
  if (window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches) return true;
  if (nav.connection?.saveData) return true;
  if ((nav.hardwareConcurrency ?? 8) <= 4) return true;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) return true;
  return false;
}
let cached: boolean | null = null;
const subscribe = (changed: () => void) => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)');
  const on = () => { cached = null; changed(); };
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
};
export function useLiteDevice(): boolean {
  return useSyncExternalStore(subscribe, () => (cached ??= compute()), () => true);
}
