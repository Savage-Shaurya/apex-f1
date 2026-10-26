'use client';

import { useSyncExternalStore } from 'react';
import { utcClock, utcStamp } from './news-format';
import { relativeAge } from './relative-age';

/** A minute clock shared by every RelativeTime on the page (one interval, not one per story). */
const listeners = new Set<() => void>();
let timer: number | undefined;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) timer = window.setInterval(() => listeners.forEach((l) => l()), 60_000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  };
}
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const serverNow = () => null;

/**
 * A story time that stays true on a cached page. The server (and hydration)
 * print the absolute UTC time; then the reader's own clock turns it into a
 * relative age (the site's one format, in the reader's own calendar),
 * refreshed once a minute. The full UTC stamp is always in the
 * tooltip and the `datetime` attribute.
 */
export function RelativeTime({ ms, className, prefix }: { ms: number; className?: string; prefix?: string }) {
  const now = useSyncExternalStore(subscribe, minuteNow, serverNow);
  if (!ms || !Number.isFinite(ms)) return null;
  const label = now === null ? utcClock(ms) : relativeAge(ms, now);
  return (
    <time dateTime={new Date(ms).toISOString()} title={utcStamp(ms)} className={className}>
      {prefix}
      {label}
    </time>
  );
}
