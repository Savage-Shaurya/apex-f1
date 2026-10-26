import type { UiResult } from '@apex/api-client/jolpica';
import { isPitLaneStart, resultStatusOf } from '@/lib/format';

/* ---------------------------------------------------------------------------
 * Race weekend rules shared by the weekend page, the calendar and tests.
 * Everything here is a pure function of provider data and the request time.
 * Nothing is estimated for display: session end times come from OpenF1 when
 * it publishes them; otherwise a session counts as "under way" for its
 * regulation window only to decide which status word to print.
 * ------------------------------------------------------------------------- */

export type SessionKind = 'FP1' | 'FP2' | 'FP3' | 'SQ' | 'S' | 'Q' | 'R';

export const SESSION_NAME: Record<string, string> = {
  FP1: 'Practice 1',
  FP2: 'Practice 2',
  FP3: 'Practice 3',
  SQ: 'Sprint Qualifying',
  S: 'Sprint',
  Q: 'Qualifying',
  R: 'Race',
};

export function sessionName(kind: string): string {
  return SESSION_NAME[kind] ?? kind;
}

/**
 * Regulation windows (minutes) used only to tell "under way" from
 * "finished" when OpenF1 has not published an end time. Practice 60, sprint
 * qualifying 44, sprint 60, qualifying 60, race 120 (the race's time limit
 * is two hours of running).
 */
const WINDOW_MIN: Record<string, number> = { FP1: 60, FP2: 60, FP3: 60, SQ: 44, S: 60, Q: 60, R: 120 };

export type SessionPhase = 'finished' | 'under-way' | 'next' | 'upcoming' | 'cancelled';

export interface WeekendSession {
  kind: string;
  /** Start shown: OpenF1's actual start when it differs from Jolpica's schedule, else Jolpica's. */
  iso: string;
  /** Jolpica's scheduled start when OpenF1 says the session started at another time, else null. */
  scheduledIso: string | null;
  /** End from OpenF1 when published, else null. */
  endIso: string | null;
  /** OpenF1 is_cancelled. */
  cancelled: boolean;
  phase: SessionPhase;
}

export interface OpenF1SessionLike {
  date_start: string;
  date_end: string;
  is_cancelled?: boolean;
  gmt_offset?: string;
  session_name?: string;
}

/** OpenF1 session names per Jolpica kind (2023 called sprint qualifying the "Sprint Shootout"). */
const OPENF1_NAMES: Record<string, readonly string[]> = {
  FP1: ['Practice 1'], FP2: ['Practice 2'], FP3: ['Practice 3'],
  SQ: ['Sprint Qualifying', 'Sprint Shootout'], S: ['Sprint'], Q: ['Qualifying'], R: ['Race'],
};

/** Jolpica and OpenF1 publish the same scheduled start; allow small edits. */
const MATCH_MS = 20 * 60_000;

/**
 * The OpenF1 row for one Jolpica session. The rows passed in belong to this
 * meeting, so the session name decides first; a start-time match within 20
 * minutes is the fallback. Matching by name matters when the real start moved
 * (Miami 2026: Jolpica lists the race at 20:00Z, it started at 17:00Z).
 */
export function matchOpenF1Session<T extends OpenF1SessionLike>(iso: string, rows: readonly T[], kind?: string): T | null {
  const names = kind ? OPENF1_NAMES[kind] : undefined;
  if (names) {
    const named = rows.filter((row) => row.session_name != null && names.includes(row.session_name));
    if (named.length === 1) return named[0]!;
  }
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return null;
  return rows.find((row) => Math.abs(Date.parse(row.date_start) - start) <= MATCH_MS) ?? null;
}

/**
 * Sessions in the order they happen (R3-TIME-9: 2023 sprint weekends list the
 * Sprint, Saturday, before Qualifying, Friday). Timed sessions sort by start;
 * a date-only session sorts by its day and stays after timed sessions that day.
 * Ties keep the provider's order (stable sort).
 */
export function chronological<T extends { iso: string }>(sessions: readonly T[]): T[] {
  const key = (iso: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return Date.parse(`${iso}T23:59:59Z`);
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return sessions.map((s, i) => ({ s, i, k: key(s.iso) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.s);
}

/** When a session counts as over: the published end, else its regulation window (status words only, never shown as a time). */
export function sessionEndMs(s: Pick<WeekendSession, 'kind' | 'iso' | 'endIso'>): number {
  const end = s.endIso ? Date.parse(s.endIso) : NaN;
  if (Number.isFinite(end)) return end;
  return Date.parse(s.iso) + (WINDOW_MIN[s.kind] ?? 60) * 60_000;
}

/** Recompute phases at another moment (the browser clock), keeping each session's published facts. */
export function rephase(sessions: readonly WeekendSession[], now: number): WeekendSession[] {
  let nextAssigned = false;
  return sessions.map((s) => {
    const start = Date.parse(s.iso);
    let phase: SessionPhase;
    if (s.cancelled) phase = 'cancelled';
    else if (!Number.isFinite(start)) phase = 'upcoming';
    else if (now >= sessionEndMs(s)) phase = 'finished';
    else if (now >= start) phase = 'under-way';
    else if (!nextAssigned) { phase = 'next'; nextAssigned = true; }
    else phase = 'upcoming';
    if (phase === 'under-way') nextAssigned = true;
    return phase === s.phase ? s : { ...s, phase };
  });
}

/** Phase of every session in time order: finished, under way, the one next, then upcoming. */
export function weekendSessions(
  sessions: ReadonlyArray<{ kind: string; iso: string }>,
  now: number,
  openf1: readonly OpenF1SessionLike[] = [],
): WeekendSession[] {
  let nextAssigned = false;
  return chronological(sessions).map((s) => {
    const match = matchOpenF1Session(s.iso, openf1, s.kind);
    // The timing archive's start is the real one; Jolpica keeps the originally scheduled time.
    const timed = !/^\d{4}-\d{2}-\d{2}$/.test(s.iso);
    const actual = match && timed && Number.isFinite(Date.parse(match.date_start)) && Math.abs(Date.parse(match.date_start) - Date.parse(s.iso)) >= 60_000
      ? new Date(Date.parse(match.date_start)).toISOString().replace('.000Z', 'Z')
      : null;
    const iso = actual ?? s.iso;
    const start = Date.parse(iso);
    const cancelled = match?.is_cancelled === true;
    const endIso = match && Number.isFinite(Date.parse(match.date_end)) ? match.date_end : null;
    const end = endIso ? Date.parse(endIso) : start + (WINDOW_MIN[s.kind] ?? 60) * 60_000;
    let phase: SessionPhase;
    if (cancelled) phase = 'cancelled';
    else if (!Number.isFinite(start)) phase = 'upcoming';
    else if (now >= end) phase = 'finished';
    else if (now >= start) phase = 'under-way';
    else if (!nextAssigned) { phase = 'next'; nextAssigned = true; }
    else phase = 'upcoming';
    if (phase === 'under-way') nextAssigned = true;
    return { kind: s.kind, iso, scheduledIso: actual ? s.iso : null, endIso, cancelled, phase };
  });
}

/**
 * What the race classification section can truthfully say (R3-TIME-1):
 *  - classified: rows were read;
 *  - unavailable: the results read failed (never "not published yet");
 *  - awaiting: a successful read with no rows, within a day of the race end;
 *  - not-published: a successful read with no rows long after the race;
 *  - not-run: the race has not finished.
 */
export type RaceResultsState = 'classified' | 'unavailable' | 'awaiting' | 'not-published' | 'not-run';
/** How long after the race's scheduled end an empty classification still reads as "on its way". */
export const AWAITING_CLASSIFICATION_MS = 24 * 3_600_000;
const RACE_WINDOW_MS = 120 * 60_000;

export function raceResultsState(input: { read: 'available' | 'unavailable' | 'not-run'; rows: number; raceDone: boolean; raceStartIso: string; raceEndIso?: string | null; now: number }): RaceResultsState {
  if (input.rows > 0) return 'classified';
  if (input.read === 'unavailable') return 'unavailable';
  if (!input.raceDone || input.read === 'not-run') return 'not-run';
  const end = Date.parse(input.raceEndIso ?? '') || Date.parse(input.raceStartIso) + RACE_WINDOW_MS;
  return Number.isFinite(end) && input.now <= end + AWAITING_CLASSIFICATION_MS ? 'awaiting' : 'not-published';
}

export type WeekendPhase = 'upcoming' | 'in-progress' | 'finished' | 'cancelled';

export function weekendPhase(sessions: readonly WeekendSession[]): WeekendPhase {
  if (sessions.length === 0) return 'upcoming';
  if (sessions.every((s) => s.cancelled)) return 'cancelled';
  const race = sessions.find((s) => s.kind === 'R');
  if (race?.phase === 'finished') return 'finished';
  if (sessions.some((s) => s.phase === 'finished' || s.phase === 'under-way')) return 'in-progress';
  return 'upcoming';
}

/** A time zone's UTC offset in minutes at an instant ("Asia/Singapore" → 480), or null. */
export function zoneOffsetMinutes(timeZone: string | null | undefined, iso: string): number | null {
  const t = Date.parse(iso);
  if (!timeZone || !Number.isFinite(t)) return null;
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT') return 0;
    const m = name.match(/^GMT([+-])(\d{1,2}):?(\d{2})?$/);
    if (!m) return null;
    const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === '-' ? -minutes : minutes;
  } catch {
    return null;
  }
}

/** Parse OpenF1's "+08:00:00" / "-05:00:00" offsets to minutes; null when absent or malformed. */
export function parseGmtOffset(value?: string | null): number | null {
  const m = value?.trim().match(/^([+-])?(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  if (minutes > 14 * 60) return null;
  return m[1] === '-' ? -minutes : minutes;
}

/* ------------------------------------------------------------- classification */

const FINISHED = /^(finished|lapped|\+\d+ laps?)$/i;

/** True when the result counts as running to the flag (not retired, disqualified...). */
export function ranToFlag(status: string): boolean {
  return FINISHED.test(status.trim());
}

/**
 * The time or gap column of a race classification (audit H3):
 *  - the winner shows their race time;
 *  - a car that ran to the flag on the lead lap shows its gap;
 *  - a lapped car shows "+1 lap" / "+3 laps", never a time (Jolpica sends a
 *    time-like "+2.171" for lapped cars, which reads as a lead-lap gap);
 *  - any other status (Retired, Disqualified, Did not start...) shows the
 *    provider's status word.
 */
export function gapText(result: Pick<UiResult, 'position' | 'positionText' | 'laps' | 'status' | 'time'>, winnerLaps: number | null): { text: string; timing: boolean } {
  const status = result.status?.trim() || 'Unknown';
  const isWinner = result.position === 1 && /^\d+$/.test(result.positionText);
  if (isWinner) return result.time ? { text: result.time, timing: true } : { text: status, timing: false };
  const plusLaps = status.match(/^\+(\d+) laps?$/i);
  if (plusLaps) return { text: lapsDown(Number(plusLaps[1])), timing: false };
  if (!ranToFlag(status)) return { text: status, timing: false };
  if (winnerLaps != null && result.laps != null && result.laps < winnerLaps) {
    return { text: lapsDown(winnerLaps - result.laps), timing: false };
  }
  return result.time ? { text: result.time, timing: true } : { text: status, timing: false };
}

function lapsDown(n: number): string {
  return `+${n} ${n === 1 ? 'lap' : 'laps'}`;
}

/** Places gained (+) or lost (-) from the grid; null when the grid or finish is not a number (pit-lane starts, unclassified). */
export function placesGained(result: Pick<UiResult, 'grid' | 'position' | 'positionText'>): number | null {
  if (!/^\d+$/.test(result.positionText)) return null;
  if (result.grid == null || result.grid <= 0) return null;
  return result.grid - result.position;
}

/** The fastest-lap holder (rank 1), if the provider published fastest laps. */
export function fastestLapOf<T extends Pick<UiResult, 'fastestLap'>>(results: readonly T[]): T | null {
  return results.find((r) => r.fastestLap?.rank === 1) ?? null;
}

/** Points as the provider states them: whole numbers plain, halves (1950s, shortened races) with up to two decimals. */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) return '–';
  return Number.isInteger(points) ? String(points) : String(Number(points.toFixed(2)));
}

/** "1 pt" / "25 pts" (short), "1 point" / "4.5 points" (long): singular only for exactly one point. */
export function pointsLabel(points: number, form: 'short' | 'long' = 'short'): string {
  const one = points === 1;
  return `${formatPoints(points)} ${form === 'short' ? (one ? 'pt' : 'pts') : one ? 'point' : 'points'}`;
}

/* -------------------------------------------------------------- qualifying */

export interface QualifyingRowInput {
  position: string;
  Q1?: string;
  Q2?: string;
  Q3?: string;
}

/** The last qualifying part a driver set a time in ("Q3", "Q2", "Q1"), or null when no part time exists (pre-2006 single sessions). */
export function reachedPart(row: QualifyingRowInput): 'Q3' | 'Q2' | 'Q1' | null {
  if (row.Q3?.trim()) return 'Q3';
  if (row.Q2?.trim()) return 'Q2';
  if (row.Q1?.trim()) return 'Q1';
  return null;
}

/* ---------------------------------------------------------------- pit stops */

export interface PitStopInput {
  driverId: string;
  lap: string;
  stop: string;
  time: string;
  duration: string;
}

/** Pit-lane time in seconds; Jolpica's `duration` can be "1:02.123" after a long stop or a red flag. */
export function pitLaneSeconds(duration: string): number | null {
  const v = duration?.trim();
  if (!v) return null;
  const parts = v.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const seconds = parts.length === 2 ? parts[0]! * 60 + parts[1]! : parts.length === 1 ? parts[0]! : NaN;
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * A pit stop's moment as UTC ISO. Jolpica publishes the stop's time of day
 * at the track ("20:33:35"); with OpenF1's offset for the meeting it becomes
 * an instant the session clock can show in any zone. Null without an offset
 * or with a malformed time (never guessed).
 */
export function pitStopIso(raceStartIso: string, timeOfDay: string, offsetMin: number | null): string | null {
  if (offsetMin == null) return null;
  const start = Date.parse(raceStartIso);
  const m = timeOfDay?.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!Number.isFinite(start) || !m) return null;
  const local = new Date(start + offsetMin * 60_000);
  let t = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[1]), Number(m[2]), Number(m[3] ?? 0)) - offsetMin * 60_000;
  // A race that runs past local midnight: a time of day well before the start belongs to the next day.
  if (t < start - 3 * 3_600_000) t += 86_400_000;
  return new Date(t).toISOString();
}

/**
 * The weekend as calendar days: "23–25 Oct 2026", "30 Oct – 1 Nov 2026".
 * With `timeZone` (the circuit's, ./circuit-timezones) the days are the
 * circuit's own; without one they are UTC days and callers say so. Dates
 * published without a time are the local date already and never shift.
 */
export function weekendDates(firstIso: string, raceIso: string, timeZone?: string | null): string {
  const a = new Date(firstIso);
  const b = new Date(raceIso);
  if (!Number.isFinite(b.getTime())) return 'Date not published';
  const start = Number.isFinite(a.getTime()) && a.getTime() <= b.getTime() ? a : b;
  const zoneFor = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) || !timeZone ? 'UTC' : timeZone);
  const startZone = zoneFor(start === a ? firstIso : raceIso);
  const raceZone = zoneFor(raceIso);
  const ymd = (d: Date, tz: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
    return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
  };
  const part = (d: Date, tz: string, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { ...o, timeZone: tz });
  const s0 = ymd(start, startZone);
  const s1 = ymd(b, raceZone);
  const full = part(b, raceZone, { day: 'numeric', month: 'short', year: 'numeric' });
  const sameYear = s0.y === s1.y;
  if (sameYear && s0.m === s1.m) return s0.d === s1.d ? full : `${s0.d}–${full}`;
  return `${part(start, startZone, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} – ${full}`;
}

/* ------------------------------------------------------- position and grid words */

const POSITION_WORD: Record<string, string> = { R: 'DNF', D: 'DSQ', E: 'EXC', F: 'DNQ', N: 'NC' };

/**
 * The position column: the number for a classified car, else a short word.
 * Whether the car started comes from lib/format (resultStatusOf, R3-DATA-2):
 * DNS only for a car that never started (a "W" with no lap, or a no-grid-slot
 * row whose status says injury/illness), WD for a withdrawal after laps run
 * (Lauda at Fuji 1976). Other codes use the race-sheet words (DNF, DSQ...).
 */
export function positionLabel(r: Pick<UiResult, 'positionText' | 'laps'> & Partial<Pick<UiResult, 'grid' | 'status'>>): string {
  const t = r.positionText?.trim() ?? '';
  if (/^\d+$/.test(t)) return t;
  const status = resultStatusOf({ positionText: t, grid: r.grid ?? null, laps: r.laps, status: r.status });
  if (status.short === 'DNS' || status.short === 'WD') return status.short;
  return POSITION_WORD[t] ?? status.short;
}

/**
 * The grid column. Grid 0 is a pit-lane start only for a car that then ran
 * at least one lap; grid 0 with no laps is a car that never started, shown
 * as a dash (R3-DATA-3, Imola 1994).
 */
export function gridLabel(r: Pick<UiResult, 'grid' | 'laps'>): string {
  if (r.grid == null) return '–';
  if (r.grid === 0) return isPitLaneStart(r) ? 'Pit lane' : '–';
  return String(r.grid);
}

/** "1:32.345" or "58.123" to seconds; null for anything else. */
export function lapSeconds(time: string | undefined | null): number | null {
  const m = time?.trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  const v = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return Number.isFinite(v) ? v : null;
}
