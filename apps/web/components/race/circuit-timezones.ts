import { CIRCUIT_TIME_ZONES } from '@/lib/circuits/timezones';

/* ---------------------------------------------------------------------------
 * The time zone each circuit keeps (IANA names), so a weekend's dates read
 * as the circuit's own calendar days, the way the event itself publishes
 * them (Las Vegas 2026: Thu 19 to Sat 21 Nov local, which is Fri 20 to Sun 22
 * Nov in UTC). Keyed by Jolpica circuitId; countries with a single zone fall
 * back by country name. A circuit in neither list returns null and callers
 * label the dates UTC instead of guessing.
 *
 * Seasons that publish a date without a start time (Jolpica, before 2005 for
 * races and 2022 for practice) already carry the local date; those are never
 * shifted (see weekendDates).
 * ------------------------------------------------------------------------- */

// Every Jolpica circuit id: the one table in lib/circuits/timezones.ts (R3-CODE-6).
// The country fallback below only covers a circuit added to Jolpica before that table.
const BY_COUNTRY: Record<string, string> = {
  Austria: 'Europe/Vienna',
  Azerbaijan: 'Asia/Baku',
  Bahrain: 'Asia/Bahrain',
  Belgium: 'Europe/Brussels',
  China: 'Asia/Shanghai',
  France: 'Europe/Paris',
  Germany: 'Europe/Berlin',
  Hungary: 'Europe/Budapest',
  India: 'Asia/Kolkata',
  Italy: 'Europe/Rome',
  Japan: 'Asia/Tokyo',
  Korea: 'Asia/Seoul',
  Malaysia: 'Asia/Kuala_Lumpur',
  Monaco: 'Europe/Monaco',
  Netherlands: 'Europe/Amsterdam',
  Portugal: 'Europe/Lisbon',
  Qatar: 'Asia/Qatar',
  'Saudi Arabia': 'Asia/Riyadh',
  Singapore: 'Asia/Singapore',
  Spain: 'Europe/Madrid',
  Sweden: 'Europe/Stockholm',
  Switzerland: 'Europe/Zurich',
  Turkey: 'Europe/Istanbul',
  UAE: 'Asia/Dubai',
  UK: 'Europe/London',
  Argentina: 'America/Argentina/Buenos_Aires',
  'South Africa': 'Africa/Johannesburg',
  Morocco: 'Africa/Casablanca',
};

/**
 * The circuit's IANA time zone, or null when it is not known. The complete
 * table in lib/circuits/timezones decides first (R3-CODE-6); the country
 * list only covers ids that table does not know yet.
 */
export function circuitTimeZone(circuitId: string, country?: string | null): string | null {
  return CIRCUIT_TIME_ZONES[circuitId] ?? (country ? BY_COUNTRY[country] ?? null : null);
}
