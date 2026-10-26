'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { POLL_INTERVAL_MS, ageLabel, refreshPlan, type TimedSession } from '@/lib/data-freshness';
import { useClock } from './use-clock';

const NAMES: Record<string, string> = {
  FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', SQ: 'Sprint qualifying', S: 'Sprint', Q: 'Qualifying', R: 'Race',
};
/** setTimeout cannot hold more than ~24.8 days; boundaries further away are re-planned on the next render. */
const MAX_TIMER_MS = 24 * 3_600_000;
/** Race-weekend pages are rebuilt at most a minute after a request finds them stale (revalidate = 60). */
const PAGE_REBUILD_MS = 70_000;

/**
 * Keeps a race-weekend page current without a reload and without fake data.
 *
 * - While a session is under way, or a classification (qualifying, sprint,
 *   race) is due, it re-requests the page from the server once a minute
 *   (`router.refresh()`: the same cached page every visitor gets, so it adds
 *   no provider traffic). The final classification appears on its own once
 *   Jolpica F1 publishes it.
 * - Before a session, after results are in, and once the awaiting window has
 *   passed, it sends nothing. A hidden tab never polls; it catches up when
 *   shown again.
 * - At each real boundary (a session's start or end) it refreshes once, so
 *   server-rendered states move on with the clock.
 * - The stamp states the true age of the render the visitor is looking at
 *   (`renderedAt`, set when the server built the page from provider data).
 */
export function LiveRefresh({
  sessions,
  published,
  renderedAt,
  source = 'Jolpica F1',
  stamp = true,
  className,
}: {
  sessions: TimedSession[];
  /** Session kinds whose classification this render already shows. */
  published: string[];
  renderedAt: number;
  source?: string;
  /** False: keep refreshing at real boundaries but show no stamp (pages outside a race weekend). */
  stamp?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const now = useClock(15_000);
  const publishedSet = useMemo(() => new Set(published), [published]);
  const plan = now === null ? null : refreshPlan(sessions, publishedSet, now);
  const polling = plan?.poll === true;
  const nextChangeAt = plan?.nextChangeAt ?? null;
  const lastRefresh = useRef(0);

  // Poll once a minute while a session runs or a classification is due (visible tabs only).
  useEffect(() => {
    if (!polling) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh.current < POLL_INTERVAL_MS / 2) return;
      lastRefresh.current = Date.now();
      router.refresh();
    };
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', refresh); };
  }, [polling, router]);

  // Refresh at the next real boundary (a start or an end), a few seconds after it.
  useEffect(() => {
    if (nextChangeAt === null) return;
    const wait = nextChangeAt - Date.now() + 5_000;
    if (wait <= 0 || wait > MAX_TIMER_MS) return;
    // Twice: right after the boundary, and again once a page cached just before it has been rebuilt.
    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      lastRefresh.current = Date.now();
      router.refresh();
    };
    const first = window.setTimeout(fire, wait);
    const second = window.setTimeout(fire, wait + PAGE_REBUILD_MS);
    return () => { window.clearTimeout(first); window.clearTimeout(second); };
  }, [nextChangeAt, router]);

  const focus = plan?.focus ?? null;
  const name = focus ? NAMES[focus.kind] ?? focus.kind : null;
  const age = now === null
    ? `at ${new Date(renderedAt).toISOString().slice(11, 16)} UTC`
    : ageLabel(renderedAt, Math.max(now, renderedAt));
  const status = focus?.phase === 'awaiting-results'
    ? ` · ${name} has finished: checking for the official classification every minute.`
    : focus?.phase === 'under-way'
      ? ` · ${name} under way: this page updates on its own when it ends.`
      : '';

  if (!stamp && !status) return null;
  return (
    <p className={`font-text text-small text-fg-3 ${className ?? ''}`} data-live-refresh={polling ? 'polling' : 'idle'}>
      <span>Page updated {age} · data from {source}</span>
      {status && <span>{status}</span>}
    </p>
  );
}
