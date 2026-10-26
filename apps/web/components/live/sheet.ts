import { cache } from 'react';
import { openf1, type OpenF1Driver, type OpenF1Session } from '@apex/api-client/openf1';
import { getActiveSeason } from '@/lib/season';
import { getCalendar, getDriverStandings, getStandingsSeason } from '@/lib/grid';
import { getMeeting, getSessionResult, type MeetingRow, type SessionResultRow } from './openf1-history';
import { summariseOpenF1Freshness } from '@/lib/openf1-shared-reader';
import { deferWrite } from '@/lib/defer-write';
import type { OpenF1Provenance } from '@apex/api-client/openf1';
import {
  buildClassification,
  canonicalNames,
  deletedLapKeys,
  fastestLap,
  finishedSessions,
  isRaceKind,
  officialBest,
  nextSession,
  failureReason,
  readFailure,
  runningSession,
  sessionKind,
  weekendState,
  isTestSession,
  type DriverInfo,
  type LapLike,
  type ReadFailure,
  type SheetKind,
  type WeekendState,
} from './sheet-model';

/**
 * One loader for the three /live screens. It picks the latest finished
 * session that OpenF1 has published a classification for (or the session in
 * `?session=`), and reads only free historical endpoints: no realtime token,
 * no shared store, nothing presented as live.
 */

const READ = { strict: true, timeoutMs: 8_000 } as const;

export interface WeekendItem {
  key: number;
  name: string;
  kind: SheetKind;
  start: string;
  end: string;
  state: WeekendState;
}

/** A session running now: OpenF1 is closed to the public until it ends. */
export interface LiveNow {
  name: string;
  location: string;
  start: string;
  gmtOffset: string | null;
}

export interface SheetContext {
  state: 'ready';
  season: number;
  session: OpenF1Session;
  kind: SheetKind;
  meeting: MeetingRow | null;
  /** Meeting name for headings ("United States Grand Prix"), falling back to the location. */
  title: string;
  weekend: WeekendItem[];
  result: SessionResultRow[];
  drivers: Map<number, DriverInfo>;
  /** Why the shown session is not the newest one (e.g. race results not published yet). */
  notice: string | null;
  next: { name: string; location: string; start: string; gmtOffset: string | null } | null;
  race: { round: number; name: string; href: string } | null;
  /**
   * Set while a session runs (by its published times) or while OpenF1 refuses
   * reads with its live-session lockout. Pages then say the newest results
   * arrive after the flag, and that what they show was recorded before.
   */
  liveNow: LiveNow | null;
  /** OpenF1 refused at least one read on this page with the live-session lockout. */
  locked: boolean;
}

export type SheetLoad =
  | SheetContext
  | { state: 'unavailable'; cause: ReadFailure; reason: string; liveNow: LiveNow | null; next: SheetContext['next']; requested?: boolean }
  | { state: 'none'; season: number; next: SheetContext['next']; notice: string; liveNow: LiveNow | null };

function driverInfo(d: OpenF1Driver & { first_name?: string | null; last_name?: string | null }): DriverInfo {
  // OpenF1 full_name is "Kimi ANTONELLI"; first/last name carry normal case.
  const parts = d.full_name.trim().split(/\s+/);
  const first = d.first_name?.trim() || parts.slice(0, -1).join(' ');
  const last = d.last_name?.trim() || (parts.at(-1) ?? d.name_acronym).replace(/^(.)(.*)$/, (_, a: string, b: string) => a + b.toLowerCase());
  const colour = typeof d.team_colour === 'string' && /^[\da-f]{6}$/i.test(d.team_colour) ? `#${d.team_colour}` : null;
  return {
    number: d.driver_number,
    code: d.name_acronym,
    firstName: first,
    lastName: last,
    team: d.team_name?.trim() || 'Team not published',
    color: colour,
    headshot: typeof d.headshot_url === 'string' && d.headshot_url.startsWith('https://media.formula1.com/') ? d.headshot_url : null,
  };
}

const TOKEN = () => Boolean(process.env.OPENF1_ACCESS_TOKEN);

async function safe<T>(read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; cause: ReadFailure }> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, cause: readFailure(error, TOKEN()) };
  }
}

/** One optional read on a sheet page: the value, or the fallback plus why it failed. */
export async function settle<T>(read: () => Promise<T>, fallback: T): Promise<{ value: T; ok: boolean; cause: ReadFailure | null }> {
  try {
    return { value: await read(), ok: true, cause: null };
  } catch (error) {
    return { value: fallback, ok: false, cause: readFailure(error, TOKEN()) };
  }
}

export { failureReason };

/**
 * Names the running session from the Jolpica calendar when OpenF1's own
 * session list is locked: a session that started in the last two and a half
 * hours (races run up to two hours plus suspensions).
 */
function calendarLiveNow(calendar: Awaited<ReturnType<typeof getCalendar>> | null, now: number): LiveNow | null {
  if (!calendar) return null;
  const NAMES: Record<string, string> = { FP1: 'Practice 1', FP2: 'Practice 2', FP3: 'Practice 3', SQ: 'Sprint Qualifying', S: 'Sprint', Q: 'Qualifying', R: 'Race' };
  for (const race of calendar.races) {
    for (const s of race.sessions) {
      const t = Date.parse(s.iso);
      if (Number.isFinite(t) && t <= now && now - t < 150 * 60_000 && /T\d{2}:\d{2}/.test(s.iso)) {
        return { name: NAMES[s.kind] ?? s.kind, location: race.city || race.name, start: s.iso, gmtOffset: null };
      }
    }
  }
  return null;
}

export const loadSheet = cache(async (requested: string | undefined): Promise<SheetLoad> => {
  const season = await getActiveSeason();
  // While a session is live OpenF1 refuses every free read. The session list and
  // rosters then come from the last good copy of the same query (real rows, as
  // fetched earlier); the lockout itself is still recorded so the pages say a
  // session is running.
  let lockedBySnapshot = false;
  // Every OpenF1 read on this sheet reports where its rows came from, so the
  // page can say truthfully when it shows a stored copy (R3-CODE-7).
  const ledger: OpenF1Provenance[] = [];
  const track = (provenance: OpenF1Provenance) => {
    ledger.push(provenance);
    if (provenance.source === 'last-good' && provenance.reason === 'live-session-lockout') lockedBySnapshot = true;
  };
  const snapshotFallback = { lastGood: 'fallback' as const, onProvenance: track, deferWrite };
  const [sessionsRead, calendar] = await Promise.all([
    safe(() => openf1.getSessionsForYear(season, { ...READ, revalidate: 300, ...snapshotFallback })),
    getCalendar().catch(() => null),
  ]);
  const now = calendar?.now ?? Date.now();
  if (!sessionsRead.ok) {
    return {
      state: 'unavailable',
      cause: sessionsRead.cause,
      reason: failureReason(sessionsRead.cause, 'the session list'),
      liveNow: sessionsRead.cause === 'locked' ? calendarLiveNow(calendar, now) : null,
      next: null,
    };
  }
  const sessions = sessionsRead.value;
  const upcoming = nextSession(sessions, now);
  const next = upcoming ? { name: upcoming.session_name, location: upcoming.location, start: upcoming.date_start, gmtOffset: upcoming.gmt_offset ?? null } : null;
  const runningNow = runningSession(sessions, now);
  let liveNow: LiveNow | null = runningNow
    ? { name: runningNow.session_name, location: runningNow.location, start: runningNow.date_start, gmtOffset: runningNow.gmt_offset ?? null }
    : null;
  let locked = lockedBySnapshot;
  if (locked && !liveNow) liveNow = calendarLiveNow(calendar, now);

  const finished = finishedSessions(sessions, now);
  const requestedKey = requested && /^\d{1,7}$/.test(requested) ? Number(requested) : null;
  const requestedSession = requestedKey ? finished.find((s) => s.session_key === requestedKey) ?? null : null;

  let chosen: OpenF1Session | null = null;
  let result: SessionResultRow[] = [];
  let notice: string | null = null;

  if (requestedSession) {
    const read = await safe(() => getSessionResult(requestedSession.session_key, 600, track));
    if (!read.ok) {
      // Locked on a session the timetable calls finished: OpenF1 still has a session live (overrun or red flag).
      const running = read.cause === 'locked' && !liveNow
        ? { name: requestedSession.session_name, location: requestedSession.location, start: requestedSession.date_start, gmtOffset: requestedSession.gmt_offset ?? null }
        : liveNow;
      return { state: 'unavailable', cause: read.cause, reason: failureReason(read.cause, 'this session’s classification'), liveNow: running, next, requested: true };
    }
    chosen = requestedSession;
    result = read.value;
    if (!result.length) notice = `The ${requestedSession.session_name.toLowerCase()} classification arrives shortly after the chequered flag.`;
  } else {
    if (requestedKey) notice = 'That session is not a finished session of this season, so the latest finished session is shown.';
    // Newest finished session first. Step back past one whose classification is
    // not out yet, or that OpenF1 will not serve during a live-session lockout
    // (the older sessions are usually still in the cache).
    const skipped: Array<{ s: OpenF1Session; why: 'pending' | 'locked' }> = [];
    for (const candidate of finished.slice(0, 4)) {
      const read = await safe(() => getSessionResult(candidate.session_key, 300, track));
      if (!read.ok) {
        if (read.cause !== 'locked') return { state: 'unavailable', cause: read.cause, reason: failureReason(read.cause, 'the classification'), liveNow, next };
        locked = true;
        skipped.push({ s: candidate, why: 'locked' });
        continue;
      }
      if (!read.value.length) {
        skipped.push({ s: candidate, why: 'pending' });
        if (skipped.length >= 2) break;
        continue;
      }
      chosen = candidate;
      result = read.value;
      break;
    }
    const first = skipped[0];
    if (chosen && first) {
      // A lockout is explained by the session-running panel; a notice would repeat it.
      notice = first.why === 'locked'
        ? null
        : `The ${first.s.session_name.toLowerCase()} in ${first.s.location} has finished. Its classification arrives shortly, so the previous session is shown for now.`;
    }
    if (locked && !liveNow && first) {
      // OpenF1 says a session is live although the timetable has it finished (overrun, red flag, late start).
      liveNow = { name: first.s.session_name, location: first.s.location, start: first.s.date_start, gmtOffset: first.s.gmt_offset ?? null };
    }
    if (!chosen && locked) {
      return { state: 'unavailable', cause: 'locked', reason: failureReason('locked', 'the latest classification'), liveNow, next };
    }
  }

  if (!chosen) {
    return {
      state: 'none',
      season,
      next,
      liveNow,
      notice: finished.length
        ? 'The latest classification arrives shortly after the chequered flag. Please check back soon.'
        : `No ${season} session has finished yet.`,
    };
  }

  const session = chosen;
  const [driversRead, meetingRead, official] = await Promise.all([
    safe(() => openf1.getDrivers(session.session_key, { ...READ, revalidate: 3600, ...snapshotFallback })),
    safe(() => getMeeting(session.meeting_key, 3600, track)),
    // The season's official entry (Jolpica standings), so names match the rest of Apex.
    Promise.all([getStandingsSeason(), getDriverStandings()])
      .then(([meta, rows]) => (meta.season === season ? rows : []))
      .catch(() => []),
  ]);
  if (!driversRead.ok) {
    return { state: 'unavailable', cause: driversRead.cause, reason: failureReason(driversRead.cause, 'the driver list for this session'), liveNow, next };
  }
  if ((!meetingRead.ok && meetingRead.cause === 'locked') || lockedBySnapshot) locked = true;
  const freshness = summariseOpenF1Freshness(ledger);
  if (freshness.stale && freshness.asOf !== null && !locked && !notice) {
    const at = new Date(freshness.asOf).toISOString().slice(11, 16);
    notice = `OpenF1 did not answer just now, so this is its stored copy as fetched at ${at} UTC.`;
  }
  const drivers = canonicalNames(
    new Map(driversRead.value.map((d) => [d.driver_number, driverInfo(d)])),
    official.map((s) => ({ code: s.driver.code, number: s.driver.number ?? null, firstName: s.driver.firstName, lastName: s.driver.lastName })),
  );
  const meeting = meetingRead.ok ? meetingRead.value : null;

  const weekend = sessions
    .filter((s) => s.meeting_key === session.meeting_key && !isTestSession(s))
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))
    .map((s) => ({
      key: s.session_key, name: s.session_name, kind: sessionKind(s), start: s.date_start, end: s.date_end,
      // OpenF1's lockout outranks the timetable: a session it still calls live is running (overrun, red flag).
      state: locked && liveNow && s.date_start === liveNow.start && s.location === liveNow.location ? 'running' as const : weekendState(s, now),
    }));

  // Match the Jolpica calendar round by date (OpenF1 has no round number). The
  // meeting end comes from OpenF1 meetings, or the weekend's last session.
  let race: SheetContext['race'] = null;
  const meetingEnd = meeting?.date_end ?? weekend.at(-1)?.end;
  if (calendar && meetingEnd) {
    const end = Date.parse(meetingEnd);
    const match = calendar.races.find((r) => Math.abs(Date.parse(r.raceStartIso) - end) < 36 * 3_600_000);
    if (match) race = { round: match.round, name: match.name, href: `/schedule/${match.season}/${match.routeSlug ?? match.slug}` };
  }

  return {
    state: 'ready',
    season,
    session,
    kind: sessionKind(session),
    meeting,
    title: meeting?.meeting_name ?? race?.name ?? session.location,
    weekend,
    result,
    drivers,
    notice,
    next,
    race,
    liveNow,
    locked,
  };
});

export function sessionHref(base: '/live/timing' | '/live/track' | '/live/race-control', key: number | null | undefined): string {
  return key ? `${base}?session=${key}` : base;
}

/**
 * The fastest lap that counts, for /live/timing and /live/track. Practice and
 * qualifying take the official best time from the classification and find
 * that lap; races (no best-lap field in session_result) drop laps that race
 * control deleted. `unmatched` is true when the classification names a best
 * time the lap feed does not hold, so the page can say so honestly.
 */
export async function countedFastestLap<T extends LapLike>(ctx: SheetContext, laps: readonly T[]): Promise<{ lap: T | null; unmatched: boolean }> {
  const official = officialBest(ctx.kind, buildClassification(ctx.kind, ctx.result, ctx.drivers));
  if (official) {
    const lap = fastestLap(laps, { official });
    return { lap, unmatched: lap === null && laps.length > 0 };
  }
  let deleted = new Set<string>();
  if (isRaceKind(ctx.kind)) {
    const messages = await safe(() => openf1.getRaceControl(ctx.session.session_key, { ...READ, revalidate: 3600 }));
    if (messages.ok) deleted = deletedLapKeys(messages.value);
  }
  return { lap: fastestLap(laps, { deleted }), unmatched: false };
}
