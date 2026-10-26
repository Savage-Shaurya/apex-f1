'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { preciseSessionTimestamp } from '@/lib/session-calendar';

export interface CountdownParts {
  valid: boolean;
  started: boolean;
  days: number | null;
  hours: number | null;
  minutes: number | null;
  seconds: number | null;
}

/** Split the time left until `target` into parts; `now` null (server HTML) gives dashes. */
export function countdownParts(target: number | null, now: number | null): CountdownParts {
  const valid = target !== null && Number.isFinite(target);
  const delta = !valid || now === null ? null : Math.max(0, target - now);
  return {
    valid,
    started: delta === 0,
    days: delta === null ? null : Math.floor(delta / 86_400_000),
    hours: delta === null ? null : Math.floor((delta % 86_400_000) / 3_600_000),
    minutes: delta === null ? null : Math.floor((delta % 3_600_000) / 60_000),
    seconds: delta === null ? null : Math.floor((delta % 60_000) / 1000),
  };
}

export interface CountdownClock {
  now(): number;
  setInterval(tick: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/**
 * One-second ticks until `target`, then none: the interval is cleared on the
 * tick that reaches the start, and nothing is scheduled once it has passed.
 * Returns the unsubscribe function.
 */
export function countdownSubscription(target: number | null, changed: () => void, clock: CountdownClock): () => void {
  if (target === null || clock.now() >= target) return () => {};
  const id = clock.setInterval(() => {
    changed();
    if (clock.now() >= target) clock.clearInterval(id);
  }, 1000);
  return () => clock.clearInterval(id);
}

/**
 * Ticking countdown to a real session start. Server HTML renders dashes, so
 * no clock value can mismatch on hydration. The one-second interval stops
 * as soon as the start time is reached (it never ticks on for a page left
 * open through a race), and the snapshot freezes at the target.
 */
export function useCountdown(targetIso: string): CountdownParts {
  const target = preciseSessionTimestamp(targetIso);
  const subscribe = useCallback(
    (changed: () => void) => countdownSubscription(target, changed, { now: Date.now, setInterval: (fn, ms) => window.setInterval(fn, ms), clearInterval: (id) => window.clearInterval(id) }),
    [target],
  );
  const snapshot = useCallback(() => (target === null ? null : Math.min(target, Math.floor(Date.now() / 1000) * 1000)), [target]);
  const now = useSyncExternalStore(subscribe, snapshot, () => null);
  return countdownParts(target, now);
}
