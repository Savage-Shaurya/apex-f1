/**
 * Finished-session reads for the /live pages (session_result, starting_grid,
 * meetings). Free historical data, no token, no realtime.
 *
 * Every read goes through the shared client in @apex/api-client/openf1, so it
 * gets the loopback-only base URL gate, the live-session lockout memory (no
 * doomed requests while a session runs) and the last-good copy (R3-CODE-2,
 * R3-SEC-1). This module only keeps the stricter row validation the sheet
 * relies on and maps provider failures to the sheet's reasons.
 */
import { openf1, OpenF1LiveSessionLockout, normaliseSessionResultRow, type OpenF1Provenance } from '@apex/api-client/openf1';
import { ProviderError } from '../../../../packages/api-client/src/transport';
import { deferWrite } from '@/lib/defer-write';

export class HistoryUnavailable extends Error {
  /**
   * `locked`: OpenF1 refuses every unauthenticated request, past sessions
   * included, while a Formula 1 session is running (HTTP 401, "Live F1 session
   * in progress"). It is not an outage and it ends with the session.
   */
  constructor(public reason: 'network' | 'status' | 'invalid' | 'locked') {
    super(`OpenF1 history ${reason}`);
  }
}

export interface SessionResultRow {
  session_key: number;
  driver_number: number;
  position: number | null;
  /**
   * OpenF1 sometimes sends a classification code in place of a position
   * ("RT" for a car that retired in qualifying). Kept as the code; position
   * is then null.
   */
  position_code?: string | null;
  number_of_laps: number | null;
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  /** Race/sprint: total seconds. Practice: best lap. Qualifying: [Q1, Q2, Q3]. */
  duration: number | null | Array<number | null>;
  /** Seconds, "+1 LAP", or per-segment array for qualifying. */
  gap_to_leader: number | string | null | Array<number | string | null>;
  points?: number | null;
}

export interface StartingGridRow {
  session_key: number;
  driver_number: number;
  position: number;
  lap_duration: number | null;
}

export interface MeetingRow {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name?: string;
  location?: string;
  country_name?: string;
  country_flag?: string | null;
  circuit_short_name?: string;
  circuit_image?: string | null;
  date_start: string;
  date_end?: string;
  gmt_offset?: string;
  year?: number;
}

const int = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);
const posInt = (v: unknown) => int(v) && (v as number) > 0;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || v === undefined || num(v);
/** A short capital code sent in place of a position ("RT", "DQ", "NC", "EX"). */
const positionCode = (v: unknown) => typeof v === 'string' && /^[A-Z]{2,3}$/.test(v);
const gapValue = (v: unknown) => numOrNull(v) || (typeof v === 'string' && /^\+\d+ LAPS?$/.test(v));

export function validResultRow(row: unknown, sessionKey: number): row is SessionResultRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  if (r.session_key !== sessionKey || !posInt(r.driver_number)) return false;
  if (!(r.position === null || posInt(r.position) || positionCode(r.position))) return false;
  if (!(r.number_of_laps === null || r.number_of_laps === undefined || (int(r.number_of_laps) && (r.number_of_laps as number) >= 0))) return false;
  if (![r.dnf, r.dns, r.dsq].every((b) => typeof b === 'boolean')) return false;
  const duration = Array.isArray(r.duration) ? r.duration.length <= 3 && r.duration.every(numOrNull) : numOrNull(r.duration);
  const gap = Array.isArray(r.gap_to_leader) ? r.gap_to_leader.length <= 3 && r.gap_to_leader.every(gapValue) : gapValue(r.gap_to_leader);
  return duration && gap && numOrNull(r.points);
}

function validGridRow(row: unknown, sessionKey: number): row is StartingGridRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return r.session_key === sessionKey && posInt(r.driver_number) && posInt(r.position) && numOrNull(r.lap_duration);
}

function validMeeting(row: unknown, meetingKey: number): row is MeetingRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return r.meeting_key === meetingKey && typeof r.meeting_name === 'string' && r.meeting_name.length > 0 && r.meeting_name.length < 200
    && typeof r.date_start === 'string' && Number.isFinite(Date.parse(r.date_start));
}

/** A provider failure in the sheet's terms. */
function unavailable(error: unknown): HistoryUnavailable {
  if (error instanceof HistoryUnavailable) return error;
  if (error instanceof OpenF1LiveSessionLockout) return new HistoryUnavailable('locked');
  if (error instanceof ProviderError) {
    if (error.code === 'invalid-response' || error.code === 'invalid-input') return new HistoryUnavailable('invalid');
    if (error.code === 'http') return new HistoryUnavailable('status');
  }
  return new HistoryUnavailable('network');
}
const READ = { strict: true, lastGood: 'fallback', deferWrite } as const;
/** Optional observer told whether rows came from OpenF1 now or from the stored last-good copy (and why). */
export type ProvenanceObserver = (provenance: OpenF1Provenance) => void;

/** A coded position becomes position null plus its code, so tables never sort or print a string as a place. */
export function normaliseResultRow(row: SessionResultRow & { position: unknown }): SessionResultRow {
  return normaliseSessionResultRow(row as SessionResultRow & { position: number | string | null }) as SessionResultRow;
}

/** Final classification of one session (empty until OpenF1 publishes it). */
export async function getSessionResult(sessionKey: number, revalidate = 300, onProvenance?: ProvenanceObserver): Promise<SessionResultRow[]> {
  if (!posInt(sessionKey)) throw new HistoryUnavailable('invalid');
  let data: unknown[];
  try { data = await openf1.getSessionResult(sessionKey, { ...READ, revalidate, onProvenance }); } catch (error) { throw unavailable(error); }
  if (!data.every((row) => validResultRow(row, sessionKey))) throw new HistoryUnavailable('invalid');
  return data as SessionResultRow[];
}

/** Starting grid, stored by OpenF1 under the qualifying (or sprint qualifying) session. */
export async function getStartingGrid(qualifyingKey: number, revalidate = 3600, onProvenance?: ProvenanceObserver): Promise<StartingGridRow[]> {
  if (!posInt(qualifyingKey)) throw new HistoryUnavailable('invalid');
  let data: unknown[];
  try { data = await openf1.getStartingGrid(qualifyingKey, { ...READ, revalidate, onProvenance }); } catch (error) { throw unavailable(error); }
  if (!data.every((row) => validGridRow(row, qualifyingKey))) throw new HistoryUnavailable('invalid');
  return data as StartingGridRow[];
}

export async function getMeeting(meetingKey: number, revalidate = 3600, onProvenance?: ProvenanceObserver): Promise<MeetingRow | null> {
  if (!posInt(meetingKey)) throw new HistoryUnavailable('invalid');
  let meeting: unknown;
  try { meeting = await openf1.getMeeting(meetingKey, { ...READ, revalidate, onProvenance }); } catch (error) { throw unavailable(error); }
  if (meeting === null) return null;
  if (!validMeeting(meeting, meetingKey)) throw new HistoryUnavailable('invalid');
  return meeting;
}
