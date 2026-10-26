import { NEUTRAL_TEAM_COLOUR, type TeamColours } from './team-colours';
// Country-code → flag emoji and other small format helpers.
// Pure functions. No deps.

const NATIONALITY_TO_CC: Record<string, string> = {
  British: 'GB',
  English: 'GB',
  Scottish: 'GB',
  Welsh: 'GB',
  'Northern Irish': 'GB',
  Dutch: 'NL',
  German: 'DE',
  French: 'FR',
  Spanish: 'ES',
  Italian: 'IT',
  Monégasque: 'MC',
  Monegasque: 'MC',
  Brazilian: 'BR',
  Argentine: 'AR',
  Argentinian: 'AR',
  Mexican: 'MX',
  American: 'US',
  Canadian: 'CA',
  Australian: 'AU',
  'New Zealander': 'NZ',
  Thai: 'TH',
  Japanese: 'JP',
  Chinese: 'CN',
  Finnish: 'FI',
  Belgian: 'BE',
  Austrian: 'AT',
  Swiss: 'CH',
  Swedish: 'SE',
  Danish: 'DK',
  Polish: 'PL',
  Russian: 'RU',
  Indian: 'IN',
  Hungarian: 'HU',
  Colombian: 'CO',
  Venezuelan: 'VE',
  Czech: 'CZ',
  Portuguese: 'PT',
  Irish: 'IE',
  'South African': 'ZA',
  Malaysian: 'MY',
  Indonesian: 'ID',
  Liechtensteiner: 'LI',
};

const COUNTRY_TO_CC: Record<string, string> = {
  Australia: 'AU',
  Austria: 'AT',
  Azerbaijan: 'AZ',
  Bahrain: 'BH',
  Belgium: 'BE',
  Brazil: 'BR',
  Canada: 'CA',
  China: 'CN',
  France: 'FR',
  Germany: 'DE',
  Hungary: 'HU',
  Italy: 'IT',
  Japan: 'JP',
  Malaysia: 'MY',
  Mexico: 'MX',
  Monaco: 'MC',
  Netherlands: 'NL',
  Portugal: 'PT',
  Qatar: 'QA',
  Russia: 'RU',
  'Saudi Arabia': 'SA',
  Singapore: 'SG',
  Spain: 'ES',
  Turkey: 'TR',
  UAE: 'AE',
  'United Arab Emirates': 'AE',
  UK: 'GB',
  'United Kingdom': 'GB',
  USA: 'US',
  'United States': 'US',
  Vietnam: 'VN',
};

export function nationalityToCountryCode(nat?: string): string | null {
  if (!nat) return null;
  return NATIONALITY_TO_CC[nat] ?? null;
}

export function countryNameToCode(name?: string): string | null {
  if (!name) return null;
  return COUNTRY_TO_CC[name] ?? null;
}

export function flagEmoji(cc: string | null): string {
  if (!cc || !/^[a-z]{2}$/i.test(cc)) return '🏁';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (cc.toUpperCase().charCodeAt(0) - 65),
    base + (cc.toUpperCase().charCodeAt(1) - 65),
  );
}

/**
 * Team colour for a Jolpica constructorId from the live map built in
 * lib/grid.ts (`getTeamColours`, OpenF1 `team_colour`). No hard-coded
 * liveries: a team without a live colour gets the neutral colour.
 */
export function teamColorBySlug(slug?: string | null, colours?: TeamColours): string {
  return (slug && colours?.[slug]) || NEUTRAL_TEAM_COLOUR;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

/** Feed titles sometimes arrive with HTML entities still encoded (&#8217;). */
export function decodeEntities(text?: string | null): string {
  if (!text) return '';
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** "Bahrain Grand Prix in Malaysia" -> "Bahrain in Malaysia"; "Italian Grand Prix" -> "Italian". */
export function shortRaceName(name: string): string {
  return name.replace(/\s*Grand Prix\s*/i, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ergast/Jolpica `positionText` codes for unclassified results, spelled out.
 * "W" (withdrawn) alone does not say whether the car started: Lauda withdrew
 * after 2 laps at Fuji 1976, while 2026 "W" rows are cars that never started.
 * Use resultStatusOf() with the row's laps to tell them apart (R3-DATA-2).
 */
const RESULT_STATUS: Record<string, { short: string; long: string }> = {
  R: { short: 'RET', long: 'Retired · DNF' },
  D: { short: 'DSQ', long: 'Disqualified' },
  E: { short: 'EXC', long: 'Excluded' },
  W: { short: 'WD', long: 'Withdrawn' },
  F: { short: 'DNQ', long: 'Failed to qualify' },
  N: { short: 'NC', long: 'Not classified' },
};
const DID_NOT_START = { short: 'DNS', long: 'Did not start' } as const;
const WITHDREW_IN_RACE = { short: 'WD', long: 'Withdrew during the race' } as const;

export function resultStatus(positionText: string): { short: string; long: string } {
  return RESULT_STATUS[positionText] ?? { short: positionText || 'NC', long: 'Not classified' };
}

/** The facts on a race result row that say whether the car took the start. */
export interface StartFacts {
  positionText: string;
  grid: number | null;
  /** Laps completed; null when the provider did not publish it. */
  laps?: number | null;
  status?: string;
}

/** Statuses that, on a row with no lap and no grid slot, mean the car never started (injury, illness, ...). */
const NON_START_STATUS = /\b(did not start|not started|withdr[a-z]*|injury|injured|illness|ill|unwell)\b/i;

/**
 * True when the row proves the car did not start the race: no lap completed and
 * either the provider says so ("Did not start"), the entry was withdrawn, or it
 * had no grid slot with a non-race reason (Barrichello, Imola 1994: "Injury").
 * A car with a lap completed always started (R3-DATA-2).
 */
export function didNotStart(r: StartFacts): boolean {
  if (r.laps == null || r.laps > 0) return false;
  const status = r.status ?? '';
  if (/did not start|not started/i.test(status)) return true;
  if (r.positionText === 'W') return true;
  return r.grid === 0 && (r.positionText === 'R' || r.positionText === 'N') && NON_START_STATUS.test(status);
}

/**
 * Jolpica writes grid 0 both for a pit-lane start and for "no grid slot"
 * (non-starters). Only a car that completed at least one lap from grid 0
 * started from the pit lane (R3-DATA-3: Ratzenberger and Barrichello at
 * Imola 1994, Ireland at Monaco 1961, Modena at Monaco 1988 never started).
 */
export function isPitLaneStart(r: Pick<StartFacts, 'grid' | 'laps'>): boolean {
  return r.grid === 0 && r.laps != null && r.laps > 0;
}

/** True when grid is 0 but the car did not start from the pit lane: there was no grid slot to show. */
export function hasNoGridSlot(r: Pick<StartFacts, 'grid' | 'laps'>): boolean {
  return r.grid === 0 && !isPitLaneStart(r);
}

/**
 * Status code for an unclassified row, using its laps: DNS only for a car that
 * never started; a withdrawal after laps run is "WD" (withdrew during the race).
 * Classified rows (numeric positionText) are not passed here.
 */
export function resultStatusOf(r: StartFacts): { short: string; long: string } {
  if (didNotStart(r)) return DID_NOT_START;
  if (r.positionText === 'W' && r.laps != null && r.laps > 0) return WITHDREW_IN_RACE;
  return resultStatus(r.positionText);
}
