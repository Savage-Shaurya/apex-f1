/**
 * Every circuitId the Jolpica (Ergast) archive has published for a
 * championship race, from `GET /ergast/f1/circuits/?limit=100` (78 ids,
 * read 2026-10-25). Routing identity only: nothing here is displayed.
 *
 * Used solely when the calendar provider is unreachable, so a race URL whose
 * circuit has never hosted a race can still answer 404 instead of a
 * "temporarily unavailable" 200. While the provider is reachable, the live
 * calendar decides. A brand-new venue missing from this list only 404s during
 * a provider outage; add it here when Jolpica publishes it.
 */
export const KNOWN_CIRCUIT_IDS: ReadonlySet<string> = new Set([
  'adelaide', 'ain-diab', 'aintree', 'albert_park', 'americas', 'anderstorp', 'avus', 'bahrain',
  'baku', 'boavista', 'brands_hatch', 'bremgarten', 'buddh', 'catalunya', 'charade', 'dallas',
  'detroit', 'dijon', 'donington', 'essarts', 'estoril', 'fuji', 'galvez', 'george',
  'hockenheimring', 'hungaroring', 'imola', 'indianapolis', 'interlagos', 'istanbul', 'jacarepagua',
  'jarama', 'jeddah', 'jerez', 'kyalami', 'las_vegas', 'lemans', 'long_beach', 'losail', 'madring',
  'magny_cours', 'marina_bay', 'miami', 'monaco', 'monsanto', 'montjuic', 'monza', 'mosport',
  'mugello', 'nivelles', 'nurburgring', 'okayama', 'pedralbes', 'pescara', 'phoenix', 'portimao',
  'red_bull_ring', 'reims', 'ricard', 'riverside', 'rodriguez', 'sebring', 'sepang', 'shanghai',
  'silverstone', 'sochi', 'spa', 'suzuka', 'tremblant', 'valencia', 'vegas', 'villeneuve',
  'watkins_glen', 'yas_marina', 'yeongam', 'zandvoort', 'zeltweg', 'zolder',
]);

/** `monaco`, or the canonical `monaco-round-8` (rounds 1 to 30). */
export function isKnownRaceRouteKey(key: string): boolean {
  const match = key.match(/^(.+?)(?:-round-([1-9]\d?))?$/);
  if (!match) return false;
  const round = match[2] === undefined ? null : Number(match[2]);
  if (round !== null && round > 30) return false;
  return KNOWN_CIRCUIT_IDS.has(match[1]!);
}
