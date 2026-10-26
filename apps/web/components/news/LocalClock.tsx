'use client';

import { useSyncExternalStore } from 'react';
import { utcStamp } from './news-format';

const noop = () => () => {};
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A story's clock time, "14:32", in the reader's own time zone. The server
 * (and hydration) print the UTC time in the same five characters, so the
 * swap after hydration moves nothing. The full stamp is in the tooltip and
 * the `datetime` attribute.
 */
export function LocalClock({ ms, className }: { ms: number; className?: string }) {
  const local = useSyncExternalStore(noop, () => true, () => false);
  if (!ms || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const label = local ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return (
    <time dateTime={d.toISOString()} title={utcStamp(ms)} className={className}>
      {label}
      {!local && <span className="sr-only"> UTC</span>}
    </time>
  );
}
