/**
 * The one relative-age format of the whole site (R3-TIME-4): home ticker,
 * /latest, /video and the newsletter preview all print a story's age with
 * this function, so the same story never reads "3 h ago" in one place and
 * "2 hr ago" in another. Promote to lib/ds when the shared layer reopens.
 *
 *   just now · 12 min ago · 3 h ago · yesterday · 4 days ago · 18 Oct
 *
 * Minutes and hours are floored (a story 2 h 50 min old is "2 h ago", never
 * rounded up to an age it has not reached). "Yesterday" and day counts are
 * calendar days in `timeZone` (the viewer's own zone on the client), so an
 * evening reader in Mexico City never sees Monday's label on a Sunday
 * (R3-TIME-3). A timestamp slightly in the future (publisher clock skew)
 * reads "just now".
 *
 * Pure: pass `now` and, on the server, an explicit zone.
 */
const DAY_MS = 86_400_000;

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

/** "2026-10-25": the calendar day of `ms` in `timeZone` (viewer's zone when omitted). */
export function dayKeyIn(ms: number, timeZone?: string): string {
  const id = timeZone ?? '';
  let fmt = keyFormatters.get(id);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    keyFormatters.set(id, fmt);
  }
  // en-CA formats as YYYY-MM-DD; rebuild from parts so no engine quirk can change it.
  const parts = fmt.formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Whole calendar days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

export function relativeAge(ms: number | null | undefined, now: number, timeZone?: string): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const delta = now - ms;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  const days = daysBetween(dayKeyIn(ms, timeZone), dayKeyIn(now, timeZone));
  // Under a day old and still the same calendar day, or within 6 hours across midnight: hours read best.
  if (delta < DAY_MS && (days === 0 || delta < 6 * 3_600_000)) return `${Math.floor(delta / 3_600_000)} h ago`;
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: timeZone ?? undefined }).format(ms);
}
