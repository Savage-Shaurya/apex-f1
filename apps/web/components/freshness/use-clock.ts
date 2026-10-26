'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The browser clock, re-read every `intervalMs` (rounded to it). Server HTML
 * and the hydration pass see `null`, so nothing time-dependent can mismatch;
 * the real time arrives right after hydration. Timers pause with the tab
 * (browsers throttle them) and catch up when it becomes visible again.
 */
export function useClock(intervalMs: number): number | null {
  const subscribe = useCallback(
    (changed: () => void) => {
      const id = window.setInterval(changed, intervalMs);
      const onVisible = () => { if (document.visibilityState === 'visible') changed(); };
      document.addEventListener('visibilitychange', onVisible);
      return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
    },
    [intervalMs],
  );
  const snapshot = useCallback(() => Math.floor(Date.now() / intervalMs) * intervalMs, [intervalMs]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
