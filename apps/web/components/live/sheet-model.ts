/**
 * Pure presentation model for the finished-session sheet (/live/*).
 * No provider calls here, so every rule is unit-tested (sheet-model.test.ts).
 */
import type { SessionResultRow, StartingGridRow } from './openf1-history';
import { toTyreCompound, type TyreCompound } from '@/components/ds/Badge';

export type SheetKind = 'practice' | 'qualifying' | 'sprint-qualifying' | 'sprint' | 'race';

export interface SessionLike {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  location: string;
  is_cancelled?: boolean;
}

export function sessionKind(s: Pick<SessionLike, 'session_name' | 'session_type'>): SheetKind {
  const name = s.session_name.toLowerCase();
  const type = s.session_type.toLowerCase();
  if (type === 'race') return name.includes('sprint') ? 'sprint' : 'race';
  if (type === 'qualifying') return name.includes('sprint') || name.includes('shootout') ? 'sprint-qualifying' : 'qualifying';
  return 'practice';
}

export const isRaceKind = (k: SheetKind) => k === 'race' || k === 'sprint';
export const isQualiKind = (k: SheetKind) => k === 'qualifying' || k === 'sprint-qualifying';

/** Short labels for the weekend switcher ("FP1", "Quali"), full name kept for screen readers. */
export function shortSessionName(name: string): string {
  const n = name.trim();
  const practice = /^Practice (\d)$/i.exec(n);
  if (practice) return `FP${practice[1]}`;
  if (/^Sprint Qualifying$|^Sprint Shootout$/i.test(n)) return 'Sprint quali';
  if (/^Qualifying$/i.test(n)) return 'Qualifying';
  return n;
}

export type WeekendState = 'finished' | 'running' | 'upcoming' | 'cancelled';

export function weekendState(s: SessionLike, now: number): WeekendState {
  if (s.is_cancelled) return 'cancelled';
  const start = Date.parse(s.date_start);
  const end = Date.parse(s.date_end);
  if (now < start) return 'upcoming';
  if (now <= end) return 'running';
  return 'finished';
}

/** Pre-season test days are not a race weekend session. */
export function isTestSession(s: Pick<SessionLike, 'session_name'>): boolean {
  return /^Day \d/i.test(s.session_name);
}

/**
 * Sessions that may hold a published classification, newest first:
 * finished, not cancelled, not testing.
 */
export function finishedSessions<T extends SessionLike>(sessions: readonly T[], now: number): T[] {
  return sessions
    .filter((s) => !isTestSession(s) && weekendState(s, now) === 'finished')
    .sort((a, b) => Date.parse(b.date_end) - Date.parse(a.date_end));
}

/** The session running now by its published times (testing excluded), if any. */
export function runningSession<T extends SessionLike>(sessions: readonly T[], now: number): T | null {
  return sessions.find((s) => !isTestSession(s) && weekendState(s, now) === 'running') ?? null;
}

/**
 * Why an OpenF1 read failed, in the words the page uses:
 *  - `locked`: OpenF1 closes its free API to the public, past sessions
 *    included, while any Formula 1 session runs (HTTP 401). It ends with the
 *    session; it is not an outage.
 *  - `invalid`: OpenF1 answered with rows that failed validation.
 *  - `network`: no usable answer (timeout, connection, other HTTP status).
 * Works on the shared client's ProviderError and the history reader's
 * HistoryUnavailable without importing either. A 401 only means the lockout
 * when no access token was sent (the free API needs none).
 */
export type ReadFailure = 'locked' | 'invalid' | 'network';

export function readFailure(error: unknown, tokenConfigured = false): ReadFailure {
  if (!error || typeof error !== 'object') return 'network';
  const e = error as { name?: unknown; reason?: unknown; code?: unknown; status?: unknown };
  if (e.reason === 'locked') return 'locked';
  if (e.reason === 'invalid' || e.code === 'invalid-response' || e.code === 'incomplete') return 'invalid';
  if (e.name === 'ProviderError' && e.code === 'http' && (e.status === 401 || e.status === 403) && !tokenConfigured) return 'locked';
  return 'network';
}

/**
 * The reason line for a failed read, by cause. `what` is lower case with its
 * article ("the lap trace"). Never "try again shortly" for the lockout: it
 * ends with the session, not with a retry.
 */
export function failureReason(cause: ReadFailure, what: string): string {
  const What = what.charAt(0).toUpperCase() + what.slice(1);
  if (cause === 'locked') return `A Formula 1 session is running right now. ${What} comes back here after the session.`;
  if (cause === 'invalid') return `${What} could not be confirmed, so none of it is shown.`;
  return `${What} could not be loaded just now. Please check back in a few minutes.`;
}

export function nextSession<T extends SessionLike>(sessions: readonly T[], now: number): T | null {
  return sessions
    .filter((s) => !s.is_cancelled && !isTestSession(s) && Date.parse(s.date_start) > now)
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0] ?? null;
}

/* ------------------------------------------------------------- formatting */

/** 94.035 -> "1:34.035"; 6120.785 -> "1:42:00.785". */
export function formatLapTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const tail = `${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${tail}`;
  if (m > 0) return `${m}:${tail}`;
  return `${s}.${String(ms).padStart(3, '0')}`;
}

/**
 * Gap as the timing sheet prints it: 0.179 -> "+0.179", 81.666 -> "+1:21.666",
 * "+1 LAP" -> "+1 lap", "+2 LAPS" -> "+2 laps".
 */
export function formatGap(gap: number | string | null | undefined): string | null {
  if (gap == null) return null;
  if (typeof gap === 'string') {
    const m = /^\+(\d+) LAPS?$/.exec(gap);
    return m ? `+${m[1]} ${m[1] === '1' ? 'lap' : 'laps'}` : null;
  }
  if (!Number.isFinite(gap) || gap < 0) return null;
  return `+${formatLapTime(gap)}`;
}

/* -------------------------------------------------------- classification */

export interface DriverInfo {
  number: number;
  code: string;
  firstName: string;
  lastName: string;
  team: string;
  color: string | null;
  headshot: string | null;
}

export interface ClassifiedRow {
  driver: DriverInfo;
  number: number;
  position: number | null;
  /** Words, never blanks: "DNF", "DNS", "DSQ", "NC". */
  status: string | null;
  laps: number | null;
  /** Qualifying segments (Q1..Q3); practice/race use `time`. */
  segments: Array<number | null>;
  /**
   * Best lap (practice), total race time (P1 of a race), or, in qualifying,
   * the time set in the segment the driver was classified in (the time that
   * decides the grid slot; null when no lap was set in that segment).
   */
  time: number | null;
  /** Qualifying only: index of the segment `time` belongs to (0 = Q1). */
  timeSegment: number | null;
  /** Qualifying only: the driver's fastest time across all segments, and its segment. */
  best: { time: number; segment: number } | null;
  /** Gap to the leader as display text ("+0.179", "+1 lap"). */
  gap: string | null;
  /** Gap in seconds when numeric (for the gap ribbon). */
  gapSeconds: number | null;
  points: number | null;
  grid: number | null;
  /** Qualifying group: 3 = reached Q3, 2 = out in Q2, 1 = out in Q1. */
  group: 1 | 2 | 3 | null;
}

const UNKNOWN = (n: number): DriverInfo => ({ number: n, code: `#${n}`, firstName: '', lastName: `Car ${n}`, team: 'Team not published', color: null, headshot: null });

/** How many cars reach Q2 / Q3 for a field size (22 cars: 16 and 10; 20 cars: 15 and 10). */
export function qualifyingCuts(field: number): { q2: number; q3: number } {
  const q3 = Math.min(10, field);
  const q2 = Math.max(q3, field - Math.ceil(Math.max(0, field - 10) / 2));
  return { q2, q3 };
}

/** Fastest time across the segments (ties keep the earlier segment). */
export function bestSegment(segments: ReadonlyArray<number | null>): { time: number; segment: number } | null {
  let time = Infinity;
  let segment = -1;
  for (let i = 0; i < segments.length; i += 1) {
    const t = segments[i];
    if (t != null && Number.isFinite(t) && t < time) { time = t; segment = i; }
  }
  return segment >= 0 ? { time, segment } : null;
}

/** OpenF1 position codes as the words the sheet prints ("RT" -> "Retired"); unknown codes print as sent. */
export function codeWord(code: string | null | undefined): string {
  if (!code) return 'NC';
  const words: Record<string, string> = { RT: 'Retired', RET: 'Retired', DQ: 'DSQ', DSQ: 'DSQ', NC: 'NC', DNS: 'DNS', DNF: 'DNF', EX: 'Excluded', EXC: 'Excluded' };
  return words[code] ?? code;
}

export function buildClassification(
  kind: SheetKind,
  result: readonly SessionResultRow[],
  drivers: ReadonlyMap<number, DriverInfo>,
  grid: readonly StartingGridRow[] = [],
): ClassifiedRow[] {
  const gridBy = new Map(grid.map((g) => [g.driver_number, g.position]));
  const ordered = [...result].sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || (b.number_of_laps ?? 0) - (a.number_of_laps ?? 0));
  // The field is the larger of the rows and the last classified position (a partial feed must not move cut lines).
  const cuts = qualifyingCuts(Math.max(ordered.length, ...ordered.map((r) => r.position ?? 0)));
  return ordered.map((r, index): ClassifiedRow => {
    const status = r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : r.position == null ? codeWord(r.position_code) : null;
    const segments = Array.isArray(r.duration) ? r.duration.map((v) => (v == null ? null : v)) : [];
    const segGaps = Array.isArray(r.gap_to_leader) ? r.gap_to_leader : [];
    let group: ClassifiedRow['group'] = null;
    if (isQualiKind(kind)) {
      const rank = r.position ?? index + 1;
      group = rank <= cuts.q3 ? 3 : rank <= cuts.q2 ? 2 : 1;
    }
    let time: number | null;
    let timeSegment: number | null = null;
    let best: ClassifiedRow['best'] = null;
    let gapRaw: number | string | null;
    if (isQualiKind(kind)) {
      timeSegment = group != null ? group - 1 : null;
      time = timeSegment != null ? (segments[timeSegment] ?? null) : null;
      best = bestSegment(segments);
      // Gaps only compare inside one segment: use the segment the driver was classified in.
      gapRaw = group != null && segments[group - 1] != null ? (segGaps[group - 1] ?? null) : null;
    } else {
      time = typeof r.duration === 'number' ? r.duration : null;
      gapRaw = Array.isArray(r.gap_to_leader) ? null : r.gap_to_leader;
    }
    const isLeader = r.position === 1;
    const gap = isLeader ? null : formatGap(gapRaw);
    const gapSeconds = typeof gapRaw === 'number' && Number.isFinite(gapRaw) ? gapRaw : isLeader ? 0 : null;
    return {
      driver: drivers.get(r.driver_number) ?? UNKNOWN(r.driver_number),
      number: r.driver_number,
      position: r.position,
      status,
      laps: r.number_of_laps ?? null,
      segments,
      time,
      timeSegment,
      best,
      gap,
      gapSeconds,
      points: typeof r.points === 'number' ? r.points : null,
      grid: gridBy.get(r.driver_number) ?? null,
      group,
    };
  });
}

export interface OfficialEntry { code: string; number: number | null; firstName: string; lastName: string; team?: string }

/**
 * Site-wide driver names on the timing sheet. OpenF1 prints "Kimi
 * Antonelli"; the rest of Apex uses the official Jolpica entry ("Andrea Kimi
 * Antonelli"). Names are swapped only when code and number both match the
 * season entry. Team names stay as OpenF1 timed them for this session: they
 * are the current entrant names ("Racing Bulls", not Jolpica's older "RB F1
 * Team"), and a driver who moved mid-season keeps the team he drove for here.
 */
export function canonicalNames(drivers: ReadonlyMap<number, DriverInfo>, official: readonly OfficialEntry[]): Map<number, DriverInfo> {
  const byCode = new Map(official.filter((o) => o.code).map((o) => [o.code, o]));
  return new Map([...drivers].map(([n, d]) => {
    const o = byCode.get(d.code);
    const match = o && (o.number == null || o.number === d.number) ? o : null;
    return [n, { ...d, firstName: match?.firstName || d.firstName, lastName: match?.lastName || d.lastName }];
  }));
}

/** Fastest time per qualifying segment (index -> driver number), for the purple mark. */
export function fastestPerSegment(rows: readonly ClassifiedRow[]): Map<number, number> {
  const best = new Map<number, { t: number; n: number }>();
  for (const row of rows) {
    row.segments.forEach((t, i) => {
      if (t == null) return;
      const cur = best.get(i);
      if (!cur || t < cur.t) best.set(i, { t, n: row.number });
    });
  }
  return new Map([...best].map(([i, v]) => [i, v.n]));
}

/**
 * Phones only (the segment columns are hidden): the time that set the grid
 * slot, named by its segment, plus the driver's best lap when it came from
 * an earlier segment. "Q3 1:36.049 · Best 1:34.950 (Q2)".
 */
export function qualiCaption(row: Pick<ClassifiedRow, 'time' | 'timeSegment' | 'best'>, segNames: readonly string[]): string[] {
  const parts: string[] = [];
  const seg = row.timeSegment != null ? segNames[row.timeSegment] : null;
  const classified = formatLapTime(row.time);
  // Non-breaking spaces keep each phrase whole: lines break only between phrases.
  if (seg && classified) parts.push(`${seg}\u00a0${classified}`);
  else if (seg && row.best) parts.push(`No\u00a0${seg}\u00a0time`);
  if (row.best && row.best.segment !== row.timeSegment) parts.push(`Best\u00a0${formatLapTime(row.best.time)}\u00a0(${segNames[row.best.segment]})`);
  return parts;
}

/** Positions gained (+) or lost (-) from the grid; null without a grid slot or a classified finish. */
export function positionChange(row: Pick<ClassifiedRow, 'grid' | 'position'>): number | null {
  if (row.grid == null || row.position == null) return null;
  return row.grid - row.position;
}

/* ----------------------------------------------------------- gap ribbon */

export interface RibbonPoint { number: number; code: string; color: string | null; gap: number; lane: number }

/**
 * Places each classified, non-lapped car on a seconds axis and assigns label
 * lanes so codes never overlap: a label moves to the next lane when it would
 * sit closer than `minSpacing` (in the same 0-1 axis units) to the previous
 * label in that lane.
 */
export function ribbonLanes(rows: readonly ClassifiedRow[], maxLanes = 3, minSpacing = 0.045): { points: RibbonPoint[]; max: number } {
  const usable = rows.filter((r) => r.gapSeconds != null && r.status == null).map((r) => ({ number: r.number, code: r.driver.code, color: r.driver.color, gap: r.gapSeconds! }));
  const max = usable.reduce((m, p) => Math.max(m, p.gap), 0);
  const lastInLane: number[] = Array.from({ length: maxLanes }, () => -Infinity);
  const points = usable
    .sort((a, b) => a.gap - b.gap)
    .map((p) => {
      const x = max > 0 ? p.gap / max : 0;
      let lane = lastInLane.findIndex((last) => x - last >= minSpacing);
      if (lane === -1) lane = lastInLane.indexOf(Math.min(...lastInLane));
      lastInLane[lane] = x;
      return { ...p, lane };
    });
  return { points, max };
}

/** Round an axis maximum up to a readable tick step. */
export function niceAxis(max: number): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 60];
  const step = steps.find((s) => max / s <= 6) ?? 60;
  return { max: Math.ceil(max / step) * step, step };
}

/* ------------------------------------------------------------ session time */

/** "-05:00:00" -> -300 minutes; null when malformed. */
export function offsetMinutes(gmtOffset: string | null | undefined): number | null {
  const m = /^([+-])?(\d{2}):(\d{2})(?::\d{2})?$/.exec(gmtOffset?.trim() ?? '');
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

/**
 * Server-formatted session time, deterministic for hydration:
 * { day: "Sat 24 Oct", utc: "21:00", local: "16:00" } (local = circuit time
 * from OpenF1's gmt_offset).
 */
export function sessionClock(iso: string, gmtOffset?: string | null): { day: string; utc: string; local: string | null; localDay: string | null } {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { day: '', utc: '', local: null, localDay: null };
  const off = offsetMinutes(gmtOffset);
  const local = off == null ? null : new Date(t + off * 60_000);
  return {
    day: DAY.format(new Date(t)),
    utc: CLOCK.format(new Date(t)),
    local: local ? CLOCK.format(local) : null,
    localDay: local ? DAY.format(local) : null,
  };
}

/** "21:04:17" UTC clock with seconds for log rows. */
export function utcSeconds(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(11, 19);
}

/* ------------------------------------------------------------- track trace */

export interface LapLike {
  driver_number: number;
  lap_number: number;
  lap_duration?: number | null;
  date_start?: string | null;
  is_pit_out_lap?: boolean | null;
  duration_sector_1?: number | null;
  duration_sector_2?: number | null;
  duration_sector_3?: number | null;
  st_speed?: number | null;
}

/**
 * Laps race control deleted, as "car|lap time" keys ("16|1:34.810"), from
 * messages like "CAR 16 (LEC) TIME 1:34.810 DELETED - TRACK LIMITS AT TURN 10
 * LAP 13". A later "... TIME 1:34.810 WILL BE REINSTATED" restores it. The
 * time is matched, not the lap number: race control counts laps differently
 * from OpenF1's laps feed.
 */
export function deletedLapKeys(messages: ReadonlyArray<{ message: string; date?: string | null }>): Set<string> {
  const keys = new Set<string>();
  const ordered = [...messages].sort((a, b) => (Date.parse(a.date ?? '') || 0) - (Date.parse(b.date ?? '') || 0));
  for (const m of ordered) {
    const hit = /\bCAR (\d{1,3})\b.*?\bTIME (\d{1,2}:\d{2}\.\d{3}) (DELETED|WILL BE REINSTATED|REINSTATED)/i.exec(m.message);
    if (!hit) continue;
    const key = `${Number(hit[1])}|${hit[2]}`;
    if (/DELETED/i.test(hit[3]!)) keys.add(key); else keys.delete(key);
  }
  return keys;
}

/**
 * The official fastest time of a session from its classification: P1's best
 * lap in practice, the fastest segment time of anyone in qualifying. Races
 * have no such field in session_result, so null.
 */
export function officialBest(kind: SheetKind, rows: readonly ClassifiedRow[]): { driver: number; time: number } | null {
  if (isRaceKind(kind)) return null;
  let out: { driver: number; time: number } | null = null;
  for (const row of rows) {
    const t = isQualiKind(kind) ? (row.best?.time ?? null) : row.time;
    if (t != null && Number.isFinite(t) && (!out || t < out.time)) out = { driver: row.number, time: t };
  }
  return out;
}

const lapKey = (l: LapLike) => `${l.driver_number}|${formatLapTime(l.lap_duration)}`;

/**
 * The session's fastest lap that counts: complete (no pit-out lap, real start
 * time, sane length), not deleted by race control, and never faster than the
 * official classification's best time. When the classification names the
 * fastest time, the matching lap of that driver is returned; if OpenF1's lap
 * feed has no such lap, null (the page says so instead of showing a lap that
 * did not count).
 */
export function fastestLap<T extends LapLike>(laps: readonly T[], opts: { deleted?: ReadonlySet<string>; official?: { driver: number; time: number } | null } = {}): T | null {
  const timed = laps.filter((l) => typeof l.lap_duration === 'number' && l.lap_duration > 30 && l.lap_duration < 400 && !l.is_pit_out_lap && l.date_start && Number.isFinite(Date.parse(l.date_start)));
  const byTime = (a: T, b: T) => a.lap_duration! - b.lap_duration! || a.lap_number - b.lap_number;
  const official = opts.official;
  if (official) {
    return timed.filter((l) => l.driver_number === official.driver && Math.abs(l.lap_duration! - official.time) < 0.0006).sort(byTime)[0] ?? null;
  }
  return timed.filter((l) => !opts.deleted?.has(lapKey(l))).sort(byTime)[0] ?? null;
}

/** Highest speed-trap reading per driver, fastest first. */
export function speedTrap<T extends LapLike>(laps: readonly T[]): Array<{ driver: number; speed: number; lap: number }> {
  const best = new Map<number, { speed: number; lap: number }>();
  for (const l of laps) {
    if (typeof l.st_speed !== 'number' || !(l.st_speed > 50 && l.st_speed < 420)) continue;
    const cur = best.get(l.driver_number);
    if (!cur || l.st_speed > cur.speed) best.set(l.driver_number, { speed: l.st_speed, lap: l.lap_number });
  }
  return [...best].map(([driver, v]) => ({ driver, ...v })).sort((a, b) => b.speed - a.speed);
}

/**
 * Top `n` of a fastest-first list with shared ranks: equal readings share a
 * place (341, 341, 330 -> 1, 1, 3) and every car tied with the n-th reading is
 * kept, so the cut never splits a tie.
 */
export function rankedTop<T extends { speed: number }>(rows: readonly T[], n: number): Array<T & { rank: number; tied: boolean }> {
  const sorted = [...rows].sort((a, b) => b.speed - a.speed);
  const cutoff = sorted[n - 1]?.speed;
  const kept = cutoff == null ? sorted : sorted.filter((r, i) => i < n || r.speed === cutoff);
  return kept.map((r) => {
    const rank = sorted.findIndex((x) => x.speed === r.speed) + 1;
    return { ...r, rank, tied: sorted.filter((x) => x.speed === r.speed).length > 1 };
  });
}

/**
 * Scale for the speed-trap dot plot: rounded to 5 km/h (10 for wide spreads)
 * with a little room either side, so no dot sits on the frame.
 */
export function speedAxis(slowest: number, fastest: number): { min: number; max: number; ticks: number[]; at: (v: number) => number } {
  const lo = Math.min(slowest, fastest);
  const hi = Math.max(slowest, fastest);
  const step = hi - lo > 30 ? 10 : 5;
  const min = Math.floor((lo - 1) / step) * step;
  const max = Math.max(min + step, Math.ceil((hi + 1) / step) * step);
  const ticks: number[] = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks, at: (v) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) };
}

export interface TracePoint { x: number; y: number; t: number }

/**
 * Projects recorded GPS samples (OpenF1 x/y, decimetres) into an SVG box of
 * `width` units, keeping the true aspect ratio and flipping y (OpenF1's y
 * grows up). `t` is seconds since the lap started.
 */
export function projectTrace(samples: ReadonlyArray<{ x: number; y: number; date: string }>, lapStartIso: string, width = 1000, pad = 40): { points: TracePoint[]; width: number; height: number } {
  const start = Date.parse(lapStartIso);
  const clean = samples
    .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(Date.parse(s.date)) && !(s.x === 0 && s.y === 0))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (clean.length < 2) return { points: [], width, height: width };
  const xs = clean.map((s) => s.x);
  const ys = clean.map((s) => s.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const scale = (width - pad * 2) / spanX;
  const height = Math.round(spanY * scale + pad * 2);
  return {
    width,
    height,
    points: clean.map((s) => ({ x: +(pad + (s.x - minX) * scale).toFixed(1), y: +(height - pad - (s.y - minY) * scale).toFixed(1), t: (Date.parse(s.date) - start) / 1000 })),
  };
}

/** Index of the last trace point at or before `t` seconds. */
export function pointAt(points: readonly TracePoint[], t: number): number {
  let lo = 0, hi = points.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/* ---------------------------------------------------------- strategy */

export interface StintBar { compound: TyreCompound | null; start: number; end: number }

/** Stints per driver from OpenF1, clipped to laps actually completed. */
export function stintBars(stints: ReadonlyArray<{ stint_number: number; compound: string; lap_start?: number | null; lap_end?: number | null }>, laps: number | null): StintBar[] {
  return [...stints]
    .sort((a, b) => a.stint_number - b.stint_number)
    .filter((s) => s.lap_start != null)
    .map((s) => {
      const start = s.lap_start!;
      const end = Math.max(start, Math.min(s.lap_end ?? laps ?? start, laps ?? Infinity));
      return { compound: toTyreCompound(s.compound), start, end };
    })
    .filter((s) => laps == null || s.start <= laps);
}

