'use client';

import { useSyncExternalStore } from 'react';
import { cn } from '@apex/ui';
import { Countdown } from '@/components/brand-c/live';
import { ClockTime } from '@/components/race/SessionClock';
import { sessionName, weekendSessions, type WeekendSession } from '@/components/race/weekend';

/* A 30-second browser clock shared by every subscriber. */
let clock = 0;
const clockListeners = new Set<() => void>();
let timer: number | null = null;
function subscribeClock(cb: () => void) {
  clockListeners.add(cb);
  if (timer == null) {
    clock = Date.now();
    timer = window.setInterval(() => { clock = Date.now(); clockListeners.forEach((l) => l()); }, 30_000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && timer != null) { window.clearInterval(timer); timer = null; }
  };
}
function readClock() {
  if (!clock) clock = Date.now();
  return clock;
}

/**
 * The next race's session list and countdown, with each status worked out
 * in the reader's browser. The server renders the phases at its render
 * moment (the page is cached, so that moment can be old); after mount the
 * phases are recomputed from the reader's clock and refreshed every 30
 * seconds, so a finished session never keeps saying "Next".
 */
export function NextRaceSessions({ sessions, serverNow }: { sessions: Array<{ kind: string; iso: string }>; serverNow: number }) {
  const now = useSyncExternalStore(subscribeClock, readClock, () => serverNow);
  const phases = weekendSessions(sessions, now);
  const nextSession = phases.find((s) => s.phase === 'next');
  const underWay = phases.find((s) => s.phase === 'under-way');
  const allDone = phases.length > 0 && phases.every((s) => s.phase === 'finished' || s.phase === 'cancelled');

  return (
    <>
      <div className="min-h-[6.5rem]">
        {underWay ? (
          <div>
            <p className="bc-label flex items-center gap-2.5 text-[color:var(--bc-silver)]"><span aria-hidden className="h-[2px] w-5 bg-[color:var(--bc-red)]" />On track now</p>
            <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">{sessionName(underWay.kind)} under way</p>
            <p className="mt-2 text-[0.92rem] text-[color:var(--bc-silver)]">Final timing appears once the session has finished.</p>
          </div>
        ) : nextSession ? (
          <div>
            <p className="bc-label text-[color:var(--bc-silver)]">{sessionName(nextSession.kind)} starts in</p>
            <Countdown iso={nextSession.iso} size="l" className="mt-3" />
          </div>
        ) : allDone ? (
          <div>
            <p className="bc-label text-[color:var(--bc-silver)]">Chequered flag</p>
            <p className="bc-wide mt-3 text-[clamp(1.4rem,2.6vw,2rem)] leading-tight">Weekend finished</p>
            <p className="mt-2 text-[0.92rem] text-[color:var(--bc-silver)]">The classification appears on the race page shortly after the chequered flag.</p>
          </div>
        ) : null}
      </div>
      <ol aria-label="Sessions" className="mt-8 border-t border-[color:var(--bc-rule)]">
        {phases.map((s) => (
          <li key={s.kind + s.iso} className={cn('relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-[color:var(--bc-rule)] py-3.5 pl-5', s.phase === 'next' && 'bg-[linear-gradient(90deg,rgb(225_6_0/0.12),transparent_70%)]')}>
            <span aria-hidden className={cn('absolute bottom-3 left-0 top-3 w-[3px] rounded-full', s.phase === 'next' || s.phase === 'under-way' ? 'bg-[color:var(--bc-red)]' : s.phase === 'finished' ? 'bg-white/55' : 'bg-white/15')} />
            <span className="min-w-0">
              <span className="bc-wide block text-[0.98rem]">{sessionName(s.kind)}</span>
              <ClockTime iso={s.iso} parts="day-time" className="bc-mono mt-1 block text-[0.85rem] text-[color:var(--bc-silver)]" />
            </span>
            <PhaseWord phase={s.phase} />
          </li>
        ))}
      </ol>
    </>
  );
}

function PhaseWord({ phase }: { phase: WeekendSession['phase'] }) {
  if (phase === 'next') return <span className="bc-label rounded-full bg-[color:var(--bc-red)] px-2.5 py-1 text-[0.66rem] text-white">Next</span>;
  if (phase === 'under-way') return <span className="bc-label rounded-full px-2.5 py-1 text-[0.66rem] text-white ring-1 ring-[color:var(--bc-red)]">On track</span>;
  if (phase === 'cancelled') return <span className="bc-label text-[0.66rem] text-[color:var(--bc-red-text)]">Cancelled</span>;
  return <span className="bc-label text-[0.66rem] text-[color:var(--bc-titanium)]">{phase === 'finished' ? 'Finished' : 'Upcoming'}</span>;
}
