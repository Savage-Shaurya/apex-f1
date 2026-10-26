import { openf1, openF1FailureReason, type FetchOpts, type OpenF1FailureReason, type OpenF1Provenance, type OpenF1Session, type OpenF1Weather } from '@apex/api-client/openf1';

/**
 * Measured track (asphalt) temperature for a race weekend, and the actual
 * session times recorded by the timing feed.
 *
 * Source: the official timing feed's weather channel, published by OpenF1
 * (`/weather`, one sample a minute while a session runs). Readings exist only
 * for sessions that have finished, and OpenF1 coverage starts in 2023. Nothing
 * here is estimated from air temperature: when there is no measured sample,
 * the state says so.
 *
 * Sessions are matched by meeting and session name, not by start time: a
 * race that started at a different time from Jolpica's schedule (2026 Miami:
 * scheduled 20:00Z, actually 17:00Z) still finds its own timing session.
 *
 * OpenF1 refuses all free requests while a session is live, so both reads use
 * the last good stored response when that happens; `asOf` / `stale` say so.
 */

export const OPENF1_FIRST_SEASON = 2023;
/** Jolpica and OpenF1 publish the same scheduled start; allow small timing edits. */
const START_MATCH_MS = 20 * 60_000;
/** A weekend's sessions never sit further than this from Jolpica's schedule. */
const MEETING_WINDOW_MS = 4 * 86_400_000;
/** Sensor drop-outs arrive as 0.0; real F1 track readings sit well inside this band. */
const MIN_TRACK_C = 1;
const MAX_TRACK_C = 80;

/** Jolpica session kind -> OpenF1 session_name(s). */
const OPENF1_SESSION_NAMES: Record<string, readonly string[]> = {
  FP1: ['Practice 1'],
  FP2: ['Practice 2'],
  FP3: ['Practice 3'],
  Q: ['Qualifying'],
  SQ: ['Sprint Qualifying', 'Sprint Shootout'],
  S: ['Sprint'],
  R: ['Race'],
};

export interface WeekendSession { kind: string; iso: string }

export interface MeasuredTrackTemp {
  kind: string;
  iso: string;
  minC: number;
  maxC: number;
  samples: number;
}

/** Freshness of the OpenF1 data behind a state. */
export interface TrackTemperatureProvenance {
  /** True when OpenF1 refused or failed and a stored earlier response was used. */
  stale: boolean;
  /** When the oldest OpenF1 response used was fetched (ms since epoch); null if unknown. */
  asOf: number | null;
  reason: OpenF1FailureReason | null;
}

export type TrackTemperatureState =
  /** At least one finished session has measured samples. */
  | ({ state: 'measured'; sessions: MeasuredTrackTemp[] } & Partial<TrackTemperatureProvenance>)
  /** No session of this weekend has finished yet. */
  | { state: 'pending' }
  /** The season predates OpenF1's timing archive. */
  | { state: 'not-covered' }
  /** Sessions finished but the provider returned no usable samples, or failed. */
  | { state: 'unavailable'; reason?: OpenF1FailureReason };

export interface TrackTemperatureProvider {
  getSessionsForYear: (year: number, opts?: FetchOpts) => Promise<OpenF1Session[]>;
  getWeatherForMeeting: (meetingKey: number, opts?: FetchOpts) => Promise<OpenF1Weather[]>;
}

/** One Jolpica session joined to the timing feed's record of it. */
export interface ReconciledSession {
  kind: string;
  /** Jolpica's scheduled start. */
  scheduledIso: string;
  /** The timing feed's start/end for this session, when OpenF1 has it. */
  actualStartIso: string | null;
  actualEndIso: string | null;
  sessionKey: number | null;
  meetingKey: number | null;
  /** Start time to use for this session: the feed's when known, else the schedule. */
  iso: string;
  /** True when the feed's start differs from the schedule by more than 20 minutes. */
  rescheduled: boolean;
}

function nameMatches(kind: string, row: OpenF1Session): boolean {
  return (OPENF1_SESSION_NAMES[kind] ?? []).includes(row.session_name);
}

/**
 * The OpenF1 meeting of this weekend: the one whose same-named sessions line
 * up with the most Jolpica sessions (exact start within 20 min counts most),
 * restricted to meetings within a few days of the schedule.
 */
export function resolveWeekendMeeting(sessions: readonly WeekendSession[], openf1Sessions: readonly OpenF1Session[]): number | null {
  const scores = new Map<number, { exact: number; near: number }>();
  for (const session of sessions) {
    const start = Date.parse(session.iso);
    if (!Number.isFinite(start)) continue;
    for (const row of openf1Sessions) {
      if (row.is_cancelled || !nameMatches(session.kind, row)) continue;
      const delta = Math.abs(Date.parse(row.date_start) - start);
      if (delta > MEETING_WINDOW_MS) continue;
      const score = scores.get(row.meeting_key) ?? { exact: 0, near: 0 };
      if (delta <= START_MATCH_MS) score.exact++;
      else score.near++;
      scores.set(row.meeting_key, score);
    }
  }
  let best: { key: number; exact: number; near: number } | null = null;
  let tie = false;
  for (const [key, score] of scores) {
    if (!best || score.exact > best.exact || (score.exact === best.exact && score.near > best.near)) { best = { key, ...score }; tie = false; }
    else if (score.exact === best.exact && score.near === best.near) tie = true;
  }
  return best && !tie ? best.key : null;
}

/** Join Jolpica's sessions to the timing feed's sessions of the same meeting by name. */
export function reconcileWeekendSessions(sessions: readonly WeekendSession[], openf1Sessions: readonly OpenF1Session[]): ReconciledSession[] {
  const meetingKey = resolveWeekendMeeting(sessions, openf1Sessions);
  const meeting = meetingKey === null ? [] : openf1Sessions.filter((row) => row.meeting_key === meetingKey && !row.is_cancelled);
  return sessions.map((session) => {
    const candidates = meeting.filter((row) => nameMatches(session.kind, row));
    const start = Date.parse(session.iso);
    // Two same-named sessions in one meeting never happen; if they did, take the nearest.
    const match = candidates.sort((a, b) => Math.abs(Date.parse(a.date_start) - start) - Math.abs(Date.parse(b.date_start) - start))[0] ?? null;
    const actualStart = match ? new Date(Date.parse(match.date_start)).toISOString() : null;
    return {
      kind: session.kind,
      scheduledIso: session.iso,
      actualStartIso: actualStart,
      actualEndIso: match ? new Date(Date.parse(match.date_end)).toISOString() : null,
      sessionKey: match?.session_key ?? null,
      meetingKey: match?.meeting_key ?? null,
      iso: actualStart ?? session.iso,
      rescheduled: !!match && Number.isFinite(start) && Math.abs(Date.parse(match.date_start) - start) > START_MATCH_MS,
    };
  });
}

function finishedMatch(session: WeekendSession, reconciled: readonly ReconciledSession[], openf1Sessions: readonly OpenF1Session[], now: number): OpenF1Session | null {
  const entry = reconciled.find((row) => row.kind === session.kind && row.scheduledIso === session.iso);
  if (!entry?.sessionKey) return null;
  const match = openf1Sessions.find((row) => row.session_key === entry.sessionKey) ?? null;
  return match && Date.parse(match.date_end) <= now ? match : null;
}

/** Pure join of Jolpica sessions, OpenF1 sessions and OpenF1 weather samples. */
export function summariseTrackTemperatures(
  sessions: readonly WeekendSession[],
  openf1Sessions: OpenF1Session[],
  weather: OpenF1Weather[],
  now: number,
): MeasuredTrackTemp[] {
  const reconciled = reconcileWeekendSessions(sessions, openf1Sessions);
  const out: MeasuredTrackTemp[] = [];
  for (const session of sessions) {
    const match = finishedMatch(session, reconciled, openf1Sessions, now);
    if (!match) continue;
    const from = Date.parse(match.date_start);
    const to = Date.parse(match.date_end);
    const readings = weather
      .filter((row) => row.session_key === match.session_key)
      .filter((row) => { const t = Date.parse(row.date); return t >= from && t <= to; })
      .map((row) => row.track_temperature)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= MIN_TRACK_C && value <= MAX_TRACK_C);
    if (readings.length === 0) continue;
    out.push({
      kind: session.kind,
      iso: session.iso,
      minC: Math.round(Math.min(...readings)),
      maxC: Math.round(Math.max(...readings)),
      samples: readings.length,
    });
  }
  return out;
}

function provenanceOf(ledger: readonly OpenF1Provenance[]): TrackTemperatureProvenance {
  const stored = ledger.filter((entry) => entry.source === 'last-good');
  if (!stored.length) return { stale: false, asOf: ledger.length ? Math.min(...ledger.map((entry) => entry.asOf)) : null, reason: null };
  const oldest = stored.reduce((a, b) => (b.asOf < a.asOf ? b : a));
  return { stale: true, asOf: oldest.asOf, reason: oldest.reason ?? null };
}

/**
 * Actual session times for a weekend from the timing feed (with last-good
 * fallback). Pages use `iso` of each entry to read weather for the hours the
 * session really ran. Seasons before 2023, or a feed failure with no stored
 * copy, return the schedule unchanged with `source: 'schedule'`.
 */
export async function loadWeekendSessionTimes(input: {
  season: number;
  sessions: readonly WeekendSession[];
  provider?: Pick<TrackTemperatureProvider, 'getSessionsForYear'>;
}): Promise<{ source: 'timing-feed' | 'schedule'; sessions: ReconciledSession[] } & TrackTemperatureProvenance> {
  const schedule = () => reconcileWeekendSessions(input.sessions, []);
  if (!Number.isSafeInteger(input.season) || input.season < OPENF1_FIRST_SEASON) return { source: 'schedule', sessions: schedule(), stale: false, asOf: null, reason: null };
  const ledger: OpenF1Provenance[] = [];
  try {
    const provider = input.provider ?? openf1;
    const openf1Sessions = await provider.getSessionsForYear(input.season, { strict: true, lastGood: 'fallback', onProvenance: (entry) => ledger.push(entry) });
    const sessions = reconcileWeekendSessions(input.sessions, openf1Sessions);
    return { source: sessions.some((row) => row.sessionKey !== null) ? 'timing-feed' : 'schedule', sessions, ...provenanceOf(ledger) };
  } catch {
    return { source: 'schedule', sessions: schedule(), stale: false, asOf: null, reason: null };
  }
}

export async function loadMeasuredTrackTemperatures(input: {
  season: number;
  sessions: readonly WeekendSession[];
  now?: number;
  provider?: TrackTemperatureProvider;
}): Promise<TrackTemperatureState> {
  const now = input.now ?? Date.now();
  const provider = input.provider ?? openf1;
  if (!Number.isSafeInteger(input.season) || input.season < OPENF1_FIRST_SEASON) return { state: 'not-covered' };
  const started = input.sessions.filter((s) => Number.isFinite(Date.parse(s.iso)) && Date.parse(s.iso) <= now);
  if (started.length === 0) return { state: 'pending' };
  const ledger: OpenF1Provenance[] = [];
  const onProvenance = (entry: OpenF1Provenance) => { ledger.push(entry); };
  try {
    const openf1Sessions = await provider.getSessionsForYear(input.season, { strict: true, lastGood: 'fallback', onProvenance });
    const reconciled = reconcileWeekendSessions(input.sessions, openf1Sessions);
    const matched = started.map((s) => finishedMatch(s, reconciled, openf1Sessions, now)).filter((s): s is OpenF1Session => s !== null);
    if (matched.length === 0) {
      // Started but not yet finished counts as pending; finished but unmatched is unavailable.
      const anyEnded = started.some((s) => Date.parse(s.iso) + 3 * 3_600_000 <= now);
      return anyEnded ? { state: 'unavailable' } : { state: 'pending' };
    }
    const meetingKeys = [...new Set(matched.map((s) => s.meeting_key))];
    if (meetingKeys.length !== 1) return { state: 'unavailable' };
    // Samples of a weekend that finished a day ago are final; keep them longer.
    const lastEnd = Math.max(...matched.map((s) => Date.parse(s.date_end)));
    const revalidate = now - lastEnd > 86_400_000 ? 86_400 : 600;
    const weather = await provider.getWeatherForMeeting(meetingKeys[0]!, { strict: true, revalidate, lastGood: 'fallback', onProvenance });
    const measured = summariseTrackTemperatures(input.sessions, openf1Sessions, weather, now);
    return measured.length > 0 ? { state: 'measured', sessions: measured, ...provenanceOf(ledger) } : { state: 'unavailable' };
  } catch (error) {
    // Say why when the timing feed is closed for a live session and nothing was stored.
    return openF1FailureReason(error) === 'live-session-lockout' ? { state: 'unavailable', reason: 'live-session-lockout' } : { state: 'unavailable' };
  }
}
