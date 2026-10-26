import { relativeAge } from '@/components/news/relative-age';
/**
 * Pure race-weekend logic for the homepage. Inputs are provider data only
 * (Jolpica calendar, standings and published classifications) plus the
 * request clock; nothing here invents a time, a result or a status.
 */

export interface WeekendSession {
  kind: string;
  iso: string;
}

export const SESSION_NAMES: Record<string, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint qualifying',
  S: 'Sprint',
  Q: 'Qualifying',
  R: 'Grand Prix',
};

/** Sessions that publish a classification in Jolpica (practice does not; its final times come from OpenF1). */
export const CLASSIFIED_SESSIONS = new Set(['Q', 'S', 'R']);

export function sessionName(kind: string): string {
  return SESSION_NAMES[kind] ?? kind;
}

/** A start time is usable only when the provider published a time of day. */
export function sessionStartMs(iso: string): number | null {
  if (!iso.includes('T')) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Races the home "Last race" may show, newest first: the calendar focus once it
 * has started (today's race), then the previous race. Across the season boundary
 * `previous` is the previous season's final round (lib/public-sport readCalendar).
 */
export function lastRaceCandidates<R extends { raceStartIso: string }>(calendar: { next: R | null; previous: R | null; now: number }): R[] {
  return [calendar.next, calendar.previous].filter((r): r is R => {
    if (!r) return false;
    const start = sessionStartMs(r.raceStartIso);
    return start !== null && start <= calendar.now;
  });
}

export function orderedSessions(sessions: readonly WeekendSession[]): WeekendSession[] {
  return [...sessions].sort((a, b) => (Date.parse(a.iso) || 0) - (Date.parse(b.iso) || 0));
}

/** The first session whose published start is still ahead. */
export function nextSession(sessions: readonly WeekendSession[], now: number): WeekendSession | null {
  return orderedSessions(sessions).find((s) => {
    const start = sessionStartMs(s.iso);
    return start !== null && start > now;
  }) ?? null;
}

export type LadderStatus = 'next' | 'upcoming' | 'classified' | 'started';

export interface LadderRow extends WeekendSession {
  name: string;
  status: LadderStatus;
  /** Top three driver codes when a classification is published. */
  podium: string[] | null;
}

/**
 * The weekend running order. A session is `classified` only when its
 * classification was published; `started` means its scheduled start has
 * passed and no classification is published (Apex never claims a session is
 * live or finished from the clock alone).
 */
export function weekendLadder(sessions: readonly WeekendSession[], now: number, published: Partial<Record<string, string[]>>): LadderRow[] {
  const next = nextSession(sessions, now);
  return orderedSessions(sessions).map((s) => {
    const podium = published[s.kind]?.length ? published[s.kind]!.slice(0, 3) : null;
    const start = sessionStartMs(s.iso);
    const status: LadderStatus = podium ? 'classified'
      : next && next.kind === s.kind && next.iso === s.iso ? 'next'
        : start !== null && start <= now ? 'started' : 'upcoming';
    return { ...s, name: sessionName(s.kind), status, podium };
  });
}

export type ResultSource = 'jolpica' | 'openf1' | null;

/**
 * One badge per result source, so the sheet never shows two near-identical
 * labels: the official Jolpica result is `Classified`; OpenF1's top three
 * after a session (practice, qualifying, sprint or race) is `Final timing`.
 */
export function resultBadge(source: ResultSource): 'Classified' | 'Final timing' {
  return source === 'jolpica' ? 'Classified' : 'Final timing';
}

/**
 * What the hero says about the Grand Prix once no session is left to count
 * down to. `classified` and `chequered` need a published top three (Jolpica
 * or OpenF1 final timing); otherwise only that the start time has passed.
 */
export function raceVerdict(row: { status: LadderStatus; source: ResultSource } | undefined): 'classified' | 'chequered' | 'start-reached' {
  if (row?.status !== 'classified') return 'start-reached';
  return row.source === 'jolpica' ? 'classified' : 'chequered';
}

/* ---------------------------------------------------- final timing (OpenF1) */

export interface TimingSession {
  session_key: number;
  date_start: string;
  date_end: string;
  is_cancelled?: boolean;
  session_name?: string;
}

/** Calendar and timing feed describe the same session when their published starts agree within 20 minutes. */
const SAME_SESSION_MS = 20 * 60_000;
/** A re-timed session (a start moved by hours, e.g. 2026 Miami) is still the same session within this window, if the names agree. */
const RETIMED_SESSION_MS = 12 * 3_600_000;

/** OpenF1 session_name values for each Jolpica session kind. */
const OPENF1_SESSION_NAMES: Record<string, readonly string[]> = {
  FP1: ['Practice 1'],
  FP2: ['Practice 2'],
  FP3: ['Practice 3'],
  SQ: ['Sprint Qualifying', 'Sprint Shootout'],
  S: ['Sprint'],
  Q: ['Qualifying'],
  R: ['Race'],
};

/**
 * The OpenF1 session for a Jolpica calendar slot: matched on start time
 * first; when the start was moved (so the times disagree), on the same
 * session name within 12 hours of the published start. Never on name alone.
 */
export function matchTimingSession<T extends TimingSession>(iso: string, sessions: readonly T[], kind?: string): T | null {
  const start = sessionStartMs(iso);
  if (start === null) return null;
  const nearest = (limit: number, accept: (s: T) => boolean): T | null => {
    let best: T | null = null;
    let bestGap = Infinity;
    for (const s of sessions) {
      if (s.is_cancelled || !accept(s)) continue;
      const gap = Math.abs(Date.parse(s.date_start) - start);
      if (Number.isFinite(gap) && gap <= limit && gap < bestGap) { best = s; bestGap = gap; }
    }
    return best;
  };
  const names = kind ? OPENF1_SESSION_NAMES[kind] : undefined;
  const sameName = (s: T) => !names || !s.session_name || names.includes(s.session_name);
  return nearest(SAME_SESSION_MS, sameName)
    ?? (names ? nearest(RETIMED_SESSION_MS, (s) => Boolean(s.session_name && names.includes(s.session_name))) : null);
}

/** A session is final once its published end has passed (Apex shows no live timing). */
export function sessionFinished(session: TimingSession, now: number): boolean {
  const end = Date.parse(session.date_end);
  return Number.isFinite(end) && end <= now;
}

/** The most recent finished, uncancelled session (its roster carries the current team colours). */
export function latestFinishedSession<T extends TimingSession>(sessions: readonly T[], now: number): T | null {
  return [...sessions]
    .filter((s) => !s.is_cancelled && sessionFinished(s, now))
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))[0] ?? null;
}

/**
 * Top three driver codes from a finished session's classification. Null
 * unless all three positions are present and every driver is on the
 * session roster: nothing is guessed.
 */
export function topThreeCodes(
  results: ReadonlyArray<{ driver_number: number; position: number | null; dsq?: boolean | null }>,
  roster: ReadonlyArray<{ driver_number: number; name_acronym: string }>,
): string[] | null {
  const codes = new Map(roster.map((d) => [d.driver_number, d.name_acronym?.trim().toUpperCase()]));
  const top: string[] = [];
  for (const place of [1, 2, 3]) {
    const row = results.find((r) => r.position === place && !r.dsq);
    const code = row ? codes.get(row.driver_number) : undefined;
    if (!code) return null;
    top.push(code);
  }
  return top;
}

/* ------------------------------------------------------------ title maths */

export interface StandingRow {
  name: string;
  points: number;
}

export interface CalendarRound {
  round: number;
  name: string;
  sessions: readonly WeekendSession[];
}

/** Maximum points a driver can score at a round (2025+ rules: no fastest-lap point). */
export function maxDriverPoints(round: CalendarRound): number {
  return 25 + (round.sessions.some((s) => s.kind === 'S') ? 8 : 0);
}

export interface TitleFight {
  leader: StandingRow;
  rival: StandingRow;
  gap: number;
  roundsLeft: number;
  pointsLeft: number;
  /** The leader's lead is larger than the points still available. */
  clinched: boolean;
  /** Challengers (the leader excluded) who can still at least draw level on points. */
  contenders: number;
  /** When the title can be decided at the next round: the lead needed after it. */
  decider: { round: CalendarRound; leadNeeded: number } | null;
}

/**
 * Championship arithmetic from published standings (after `standingsRound`)
 * and the published calendar. Returns null when it cannot be computed
 * truthfully (fewer than two ranked drivers, or a non-finite value).
 */
export function titleFight(standings: readonly StandingRow[], races: readonly CalendarRound[], standingsRound: number): TitleFight | null {
  const [leader, rival] = standings;
  if (!leader || !rival || !Number.isFinite(leader.points) || !Number.isFinite(rival.points)) return null;
  const remaining = races.filter((r) => r.round > standingsRound).sort((a, b) => a.round - b.round);
  const pointsLeft = remaining.reduce((sum, r) => sum + maxDriverPoints(r), 0);
  const gap = leader.points - rival.points;
  const clinched = gap > pointsLeft;
  const contenders = standings.slice(1).filter((s) => Number.isFinite(s.points) && s.points + pointsLeft >= leader.points).length;
  let decider: TitleFight['decider'] = null;
  const nextRound = remaining[0];
  if (!clinched && nextRound) {
    const after = pointsLeft - maxDriverPoints(nextRound);
    // Possible only if the leader can extend the lead past what remains afterwards.
    if (gap + maxDriverPoints(nextRound) > after) decider = { round: nextRound, leadNeeded: after };
  }
  return { leader, rival, gap, roundsLeft: remaining.length, pointsLeft, clinched, contenders, decider };
}

/* ---------------------------------------------------------------- format */

const utcDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const utcTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });

/** "Sun 25 Oct · 20:00 UTC" (server-rendered; the client adds the viewer's own time). */
export function utcLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Time not published';
  const day = utcDay.format(ms);
  return sessionStartMs(iso) === null ? `${day} · time to be confirmed` : `${day} · ${utcTime.format(ms)} UTC`;
}

/** "25 Oct, 11:59 UTC" for a publication timestamp. */
export function publishedUtc(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(ms)}, ${utcTime.format(ms)} UTC`;
}

/** Relative age from the request clock, for news and video ("3 h ago"): the site's one format (R3-TIME-4). Server only. */
export function ageLabel(ms: number, now: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0 || ms > now + 60_000) return null;
  return relativeAge(ms, now, 'UTC') || null;
}

/** Strip a trailing " | Publisher" or " - Publisher" that some feeds append to titles. */
export function cleanHeadline(title: string, source?: string): string {
  const text = title.replace(/\s+/g, ' ').trim();
  let out = text;
  if (source) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\s+[|\\-–]\\s+${escaped}$`, 'i'), '');
  }
  // Feed section labels after a pipe ("| Formula 1", "| Brief") are not part of the headline.
  out = out.replace(/\s+\|\s+[^|]{1,24}$/, '').trim();
  return out.length >= 12 ? out : text;
}

/* ------------------------------------------------------------ home phase */

export type HomePhase = 'build-up' | 'weekend' | 'result-in';

/** How long after a Grand Prix's start its result leads the page (the Monday after included). */
export const RESULT_IN_WINDOW_MS = 96 * 3_600_000;

/**
 * Which part of the race weekend the homepage is in, from scheduled times
 * only (designer research 4.1): `weekend` once the next round's first session
 * start has passed; `result-in` for four days after the previous Grand Prix's
 * start, while the next weekend has not begun; otherwise `build-up`.
 * Nothing here claims a session is live or finished.
 */
export function homePhase(next: { sessions: readonly WeekendSession[] } | null, previous: { raceStartIso: string } | null, now: number): HomePhase {
  const first = next ? orderedSessions(next.sessions).map((s) => sessionStartMs(s.iso)).find((ms): ms is number => ms !== null) : undefined;
  if (first !== undefined && first <= now) return 'weekend';
  const raced = previous ? sessionStartMs(previous.raceStartIso) : null;
  if (raced !== null && raced <= now && now - raced < RESULT_IN_WINDOW_MS) return 'result-in';
  return 'build-up';
}

/** Section order below the hero for each phase: what matters right now comes first. */
export function homeSectionOrder(phase: HomePhase): Array<'news' | 'last-race' | 'championship'> {
  if (phase === 'result-in') return ['last-race', 'championship', 'news'];
  if (phase === 'weekend') return ['news', 'championship', 'last-race'];
  return ['news', 'last-race', 'championship'];
}

/** The session whose start has passed within the last three hours with no final timing yet ("under way" is never claimed). */
export function startedSession(rows: readonly LadderRow[], now: number): LadderRow | null {
  return [...rows].reverse().find((r) => {
    const start = sessionStartMs(r.iso);
    return r.status === 'started' && start !== null && start <= now && now - start < 3 * 3_600_000;
  }) ?? null;
}
