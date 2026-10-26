import { preciseSessionTimestamp } from './session-calendar';

/**
 * Data freshness rules shared by pages, the client refresher and the
 * weekend-watch cron. Everything here is a pure function of real provider
 * times (Jolpica's published session starts, OpenF1's end times when known)
 * and an injectable `now`, so phase changes are tested without waiting for a
 * race weekend. Nothing here creates a value that is shown as data.
 *
 * Phases of one session, as the browser shows them:
 *   before            start time not reached (countdown)
 *   under-way         start reached, end not reached
 *   awaiting-results  a classified session (Q, S, R) has ended, Jolpica has not
 *                     published its classification yet: the page checks again
 *                     every minute, for at most AWAITING_RESULTS_MS
 *   results-in        the classification is published
 *   finished          an unclassified session (practice, sprint qualifying)
 *                     ended, or the awaiting window ran out
 */

/** Sessions Jolpica publishes a classification for. */
export const CLASSIFIED_KINDS: ReadonlySet<string> = new Set(['Q', 'S', 'R']);

/**
 * Regulation windows (minutes) used only when OpenF1 has not published an
 * end time: practice 60, sprint qualifying 44, sprint 60, qualifying 60,
 * race 120 (two hours of running). Same values as components/race/weekend.
 */
export const SESSION_WINDOW_MIN: Readonly<Record<string, number>> = { FP1: 60, FP2: 60, FP3: 60, SQ: 44, S: 60, Q: 60, R: 120 };

/** How often an open page checks for a classification while one is due. */
export const POLL_INTERVAL_MS = 60_000;
/** How long after a classified session ends the browser keeps checking. */
export const AWAITING_RESULTS_MS = 6 * 3_600_000;
/** How long after the race ends the server watch keeps checking (stewards' penalties, corrections). */
export const RACE_CORRECTION_WATCH_MS = 24 * 3_600_000;

export type LivePhase = 'before' | 'under-way' | 'awaiting-results' | 'results-in' | 'finished';

export interface TimedSession {
  kind: string;
  /** Jolpica start (or OpenF1's actual start). A date without a time has no precise start. */
  startIso: string;
  /** OpenF1's published end, when known. */
  endIso?: string | null;
}

export function sessionStartMs(session: TimedSession): number | null {
  return preciseSessionTimestamp(session.startIso);
}

/** OpenF1's end when published, else start plus the regulation window. */
export function sessionEndMs(session: TimedSession): number | null {
  const start = sessionStartMs(session);
  if (start === null) return null;
  const published = session.endIso ? Date.parse(session.endIso) : NaN;
  if (Number.isFinite(published) && published > start) return published;
  return start + (SESSION_WINDOW_MIN[session.kind] ?? 60) * 60_000;
}

/** Phase of one session at `now`. `published` = its classification is out. */
export function livePhase(session: TimedSession, now: number, published: boolean): LivePhase {
  const classified = CLASSIFIED_KINDS.has(session.kind);
  if (classified && published) return 'results-in';
  const start = sessionStartMs(session);
  const end = sessionEndMs(session);
  if (start === null || end === null || now < start) return 'before';
  if (now < end) return 'under-way';
  if (!classified) return 'finished';
  return now < end + AWAITING_RESULTS_MS ? 'awaiting-results' : 'finished';
}

/** The next instant any session changes phase on its own (start, end, end of the awaiting window). */
export function nextPhaseChangeAt(sessions: readonly TimedSession[], now: number, published: ReadonlySet<string> = new Set()): number | null {
  let soonest: number | null = null;
  for (const session of sessions) {
    // A published classification has no further phase of its own.
    if (CLASSIFIED_KINDS.has(session.kind) && published.has(session.kind)) continue;
    const start = sessionStartMs(session);
    const end = sessionEndMs(session);
    if (start === null || end === null) continue;
    const candidates = [start, end, ...(CLASSIFIED_KINDS.has(session.kind) ? [end + AWAITING_RESULTS_MS] : [])];
    for (const t of candidates) if (t > now && (soonest === null || t < soonest)) soonest = t;
  }
  return soonest;
}

export interface RefreshPlan {
  /** Re-fetch the page every POLL_INTERVAL_MS while true. */
  poll: boolean;
  /** The session that makes the page poll (the first one under way or awaiting). */
  focus: { kind: string; phase: LivePhase } | null;
  /** When to re-evaluate the plan even if nothing else happens. */
  nextChangeAt: number | null;
}

/**
 * Poll only while a session is under way (final timing and the next phase
 * follow its end) or a classification is due. Before a weekend, after
 * results are in, and once the awaiting window has passed, the page is
 * quiet: no request leaves the browser.
 */
export function refreshPlan(sessions: readonly TimedSession[], published: ReadonlySet<string>, now: number): RefreshPlan {
  let focus: RefreshPlan['focus'] = null;
  for (const session of sessions) {
    const phase = livePhase(session, now, published.has(session.kind));
    if (phase === 'under-way' || phase === 'awaiting-results') { focus = { kind: session.kind, phase }; break; }
  }
  return { poll: focus !== null, focus, nextChangeAt: nextPhaseChangeAt(sessions, now, published) };
}

/* ------------------------------------------------------- provider freshness */

export interface RaceTimes {
  season: number;
  raceStartIso: string;
  sessions: ReadonlyArray<{ kind: string; iso: string }>;
}

/** From one hour before the first session until the race's correction watch ends. */
export function isHotWeekend(race: RaceTimes, now: number): boolean {
  const starts = race.sessions.map((s) => preciseSessionTimestamp(s.iso)).filter((t): t is number => t !== null);
  const raceStart = preciseSessionTimestamp(race.raceStartIso) ?? (starts.length ? Math.max(...starts) : null);
  if (raceStart === null) return false;
  const first = starts.length ? Math.min(...starts, raceStart) : raceStart;
  const raceEnd = raceStart + SESSION_WINDOW_MIN.R! * 60_000;
  return now >= first - 3_600_000 && now < raceEnd + RACE_CORRECTION_WATCH_MS;
}

/**
 * Lifetime (seconds) of a validated provider read for one race's sessions:
 * 60 s during its weekend (results land within a minute of the next check),
 * 5 min for a recent or upcoming race, 1 h inside the 45-day correction
 * window, then a day (history does not change).
 */
export function raceReadTtlSeconds(race: RaceTimes, now: number): number {
  if (isHotWeekend(race, now)) return 60;
  const raceStart = preciseSessionTimestamp(race.raceStartIso) ?? Date.parse(race.raceStartIso);
  if (!Number.isFinite(raceStart)) return 300;
  const age = now - raceStart;
  if (age < 3 * 86_400_000) return 300;
  if (age < 45 * 86_400_000) return 3600;
  return 86_400;
}

/* ------------------------------------------------------------ server watch */

export interface WatchTarget {
  season: number;
  round: number;
  kind: 'Q' | 'S' | 'R';
  endedAt: number;
}

/**
 * Classified sessions whose results may be landing now: ended, and still
 * inside the awaiting window (the race keeps a 24-hour correction watch).
 * An empty list means the weekend-watch job has nothing to do.
 */
export function weekendWatchTargets(races: ReadonlyArray<RaceTimes & { round: number }>, now: number): WatchTarget[] {
  const out: WatchTarget[] = [];
  for (const race of races) {
    for (const s of race.sessions) {
      if (s.kind !== 'Q' && s.kind !== 'S' && s.kind !== 'R') continue;
      const end = sessionEndMs({ kind: s.kind, startIso: s.iso });
      if (end === null || now < end) continue;
      const window = s.kind === 'R' ? RACE_CORRECTION_WATCH_MS : AWAITING_RESULTS_MS;
      if (now < end + window) out.push({ season: race.season, round: race.round, kind: s.kind, endedAt: end });
    }
  }
  return out.sort((a, b) => b.endedAt - a.endedAt);
}

/** "just now", "1 min ago", "14 min ago", "2 hr ago", "3 days ago": the age of a real timestamp. */
export function ageLabel(atMs: number, now: number): string {
  const delta = Math.max(0, now - atMs);
  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
