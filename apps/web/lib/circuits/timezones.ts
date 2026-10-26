/**
 * IANA time zone of every circuit Jolpica lists (the 78 ids in known-ids.ts),
 * by the circuit's location. Intl applies each zone's historical rules, so a
 * 1970s race still gets the offset that applied then.
 */
export const CIRCUIT_TIME_ZONES: Readonly<Record<string, string>> = {
  adelaide: 'Australia/Adelaide', 'ain-diab': 'Africa/Casablanca', aintree: 'Europe/London', albert_park: 'Australia/Melbourne',
  americas: 'America/Chicago', anderstorp: 'Europe/Stockholm', avus: 'Europe/Berlin', bahrain: 'Asia/Bahrain', baku: 'Asia/Baku',
  boavista: 'Europe/Lisbon', brands_hatch: 'Europe/London', bremgarten: 'Europe/Zurich', buddh: 'Asia/Kolkata',
  catalunya: 'Europe/Madrid', charade: 'Europe/Paris', dallas: 'America/Chicago', detroit: 'America/Detroit', dijon: 'Europe/Paris',
  donington: 'Europe/London', essarts: 'Europe/Paris', estoril: 'Europe/Lisbon', fuji: 'Asia/Tokyo',
  galvez: 'America/Argentina/Buenos_Aires', george: 'Africa/Johannesburg', hockenheimring: 'Europe/Berlin',
  hungaroring: 'Europe/Budapest', imola: 'Europe/Rome', indianapolis: 'America/Indiana/Indianapolis', interlagos: 'America/Sao_Paulo',
  istanbul: 'Europe/Istanbul', jacarepagua: 'America/Sao_Paulo', jarama: 'Europe/Madrid', jeddah: 'Asia/Riyadh', jerez: 'Europe/Madrid',
  kyalami: 'Africa/Johannesburg', las_vegas: 'America/Los_Angeles', lemans: 'Europe/Paris', long_beach: 'America/Los_Angeles',
  losail: 'Asia/Qatar', madring: 'Europe/Madrid', magny_cours: 'Europe/Paris', marina_bay: 'Asia/Singapore', miami: 'America/New_York',
  monaco: 'Europe/Monaco', monsanto: 'Europe/Lisbon', montjuic: 'Europe/Madrid', monza: 'Europe/Rome', mosport: 'America/Toronto',
  mugello: 'Europe/Rome', nivelles: 'Europe/Brussels', nurburgring: 'Europe/Berlin', okayama: 'Asia/Tokyo', pedralbes: 'Europe/Madrid',
  pescara: 'Europe/Rome', phoenix: 'America/Phoenix', portimao: 'Europe/Lisbon', red_bull_ring: 'Europe/Vienna', reims: 'Europe/Paris',
  ricard: 'Europe/Paris', riverside: 'America/Los_Angeles', rodriguez: 'America/Mexico_City', sebring: 'America/New_York',
  sepang: 'Asia/Kuala_Lumpur', shanghai: 'Asia/Shanghai', silverstone: 'Europe/London', sochi: 'Europe/Moscow', spa: 'Europe/Brussels',
  suzuka: 'Asia/Tokyo', tremblant: 'America/Toronto', valencia: 'Europe/Madrid', vegas: 'America/Los_Angeles',
  villeneuve: 'America/Toronto', watkins_glen: 'America/New_York', yas_marina: 'Asia/Dubai', yeongam: 'Asia/Seoul',
  zandvoort: 'Europe/Amsterdam', zeltweg: 'Europe/Vienna', zolder: 'Europe/Brussels',
};

export function circuitTimeZone(circuitId: string | null | undefined): string | null {
  return circuitId ? CIRCUIT_TIME_ZONES[circuitId] ?? null : null;
}
