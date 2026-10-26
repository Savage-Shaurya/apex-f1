import type { UiRace } from '@apex/api-client/jolpica';
import type { OpenF1Session } from '@apex/api-client/openf1';

/** A calendar date does not establish a midnight start time. */
export function preciseSessionTimestamp(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const date = iso.slice(0, 10);
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Session array order varies between sprint eras. Use the reported times across the calendar. */
export function nextTimedSession(races: readonly UiRace[], now: number) {
  return races.flatMap(race => race.sessions.map(session => ({ race, session, timestamp: preciseSessionTimestamp(session.iso) })))
    .filter((entry): entry is { race: UiRace; session: UiRace['sessions'][number]; timestamp: number } => entry.timestamp !== null && entry.timestamp > now)
    .sort((a, b) => a.timestamp - b.timestamp || a.race.round - b.race.round)[0] ?? null;
}

/** Match the hub's confirmed cancellation behavior before any server snapshot reads. */
export function initialSessionState(session: OpenF1Session, now: number) {
  const state = session.is_cancelled ? 'completed' : now < Date.parse(session.date_start) ? 'upcoming' : now <= Date.parse(session.date_end) ? 'live' : 'completed';
  return {
    state: state as 'completed' | 'upcoming' | 'live',
    cancelled: session.is_cancelled === true,
    session_key: session.session_key, location: session.location, session_name: session.session_name,
    date_start: session.date_start, date_end: session.date_end,
    detail: session.is_cancelled ? 'This session was cancelled; no live telemetry is being requested.' : undefined,
  };
}
