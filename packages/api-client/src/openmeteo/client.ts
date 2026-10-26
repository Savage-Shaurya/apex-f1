import type { RaceWeather, OpenMeteoSource } from './types';
import { failOr, isRecord, ProviderError, requestJson } from '../transport';
import { WEATHER_CACHE_TAG } from '../cache-tags';

// Public endpoints have provider limits and noncommercial terms.
// Account entitlement must be checked separately from technical connectivity.
const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const CUSTOMER_FORECAST_BASE = 'https://customer-api.open-meteo.com/v1/forecast';
const CUSTOMER_ARCHIVE_BASE = 'https://customer-archive-api.open-meteo.com/v1/archive';
const HOURLY = ['temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'weathercode'];
const DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max', 'weathercode'];

export interface GetRaceWeatherInput {
  lat: number;
  lon: number;
  /** Inclusive UTC calendar dates; session inputs are UTC instants. */
  dateStart: string;
  dateEnd: string;
  revalidate?: number;
  fetchImpl?: typeof fetch;
  /** Connection and complete body deadline. Default 8s; maximum 15s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Background syncs can distinguish a failed provider from an empty UI. */
  strict?: boolean;
  /** Clock used to choose forecast vs archive. Defaults to the current time. */
  now?: number | Date;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp : null;
}

const DAY_MS = 86_400_000;
/** Forecast API accepts start dates up to 92 days back and end dates 15 days ahead (UTC). */
const FORECAST_PAST_DAYS = 92;
const FORECAST_FUTURE_DAYS = 15;
/** Historical reanalysis window kept by this product (five years). */
const ARCHIVE_PAST_DAYS = 1826;

/**
 * Choose the Open-Meteo backend for an inclusive UTC date window.
 *
 * A weekend that is still in progress, or that ended yesterday, reads the
 * forecast API: it serves the recent past (model analysis) together with the
 * remaining forecast hours, so race day is never left without data. Windows
 * that ended two or more days ago read the archive. Anything beyond the
 * forecast horizon (or older than the archive window) is `none`.
 */
export function pickWeatherSource(start: number, end: number, now: number | Date = Date.now()): OpenMeteoSource {
  const today = new Date(now instanceof Date ? now.getTime() : now);
  if (!Number.isFinite(today.getTime()) || !Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'none';
  today.setUTCHours(0, 0, 0, 0);
  const earliest = Math.round((start - today.getTime()) / DAY_MS);
  const latest = Math.round((end - today.getTime()) / DAY_MS);
  if (latest >= -1) {
    return latest <= FORECAST_FUTURE_DAYS && earliest >= -FORECAST_PAST_DAYS ? 'forecast' : 'none';
  }
  return earliest >= -ARCHIVE_PAST_DAYS ? 'archive' : 'none';
}

const HOUR_MS = 3_600_000;
function isoMinute(ms: number): string { return new Date(ms).toISOString().slice(0, 16) + 'Z'; }

/**
 * Normalised time axis. Unix-time responses (timeformat=unixtime) give exact
 * UTC instants for hourly rows and the local midnight of each daily row, so
 * the daily block can be the circuit's own day while hourly rows stay UTC.
 */
function times(block: unknown, key: 'hourly' | 'daily', offsetSeconds: number): string[] | null {
  if (block === undefined) return [];
  if (!isRecord(block) || !Array.isArray(block.time) || block.time.length > 800) return null;
  if (block.time.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
    return (block.time as number[]).map((seconds) => key === 'hourly'
      ? isoMinute(seconds * 1000)
      // Local midnight as an epoch: shift into local wall time (+12 h guards a DST change) and take the date.
      : new Date(seconds * 1000 + offsetSeconds * 1000 + 12 * HOUR_MS).toISOString().slice(0, 10));
  }
  // Legacy GMT string responses.
  if (offsetSeconds !== 0) return null;
  const pattern = key === 'daily' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z)?$/;
  if (!block.time.every((value) => typeof value === 'string' && pattern.test(value))) return null;
  return block.time.map((value: string) => key === 'hourly' && !value.endsWith('Z') ? `${value}Z` : value);
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^GMT$|^UTC$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }); return true; } catch { return false; }
}

function measurements(block: unknown, field: string, length: number, min: number, max: number): Array<number | null> {
  const values = isRecord(block) && Array.isArray(block[field]) ? block[field] : [];
  return Array.from({ length }, (_, index) => {
    const value = values[index];
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
  });
}

function normalize(raw: unknown, source: OpenMeteoSource, input: GetRaceWeatherInput): RaceWeather | null {
  if (!isRecord(raw) || raw.error === true) return null;
  // Hourly rows are UTC instants; the daily block is the circuit's local day
  // (timezone=auto). A string time axis is accepted only in GMT.
  const offset = raw.utc_offset_seconds;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || Math.abs(offset) > 14 * 3600) return null;
  const timezone = offset === 0 && raw.timezone === undefined ? 'GMT' : raw.timezone;
  if (!validTimezone(timezone)) return null;
  const hourlyTime = times(raw.hourly, 'hourly', offset);
  const dailyTime = times(raw.daily, 'daily', offset);
  if (hourlyTime === null || dailyTime === null) return null;
  const h = hourlyTime.length;
  const d = dailyTime.length;
  return {
    source, latitude: input.lat, longitude: input.lon, timezone, utcOffsetSeconds: offset,
    hourly: {
      time: hourlyTime,
      temperature_2m: measurements(raw.hourly, 'temperature_2m', h, -100, 100),
      precipitation: measurements(raw.hourly, 'precipitation', h, 0, 2000),
      precipitation_probability: source === 'forecast' ? measurements(raw.hourly, 'precipitation_probability', h, 0, 100) : [],
      wind_speed_10m: measurements(raw.hourly, 'wind_speed_10m', h, 0, 500),
      wind_direction_10m: measurements(raw.hourly, 'wind_direction_10m', h, 0, 360),
      weathercode: measurements(raw.hourly, 'weathercode', h, 0, 99),
    },
    daily: {
      time: dailyTime,
      temperature_2m_max: measurements(raw.daily, 'temperature_2m_max', d, -100, 100),
      temperature_2m_min: measurements(raw.daily, 'temperature_2m_min', d, -100, 100),
      precipitation_sum: measurements(raw.daily, 'precipitation_sum', d, 0, 10000),
      precipitation_probability_max: source === 'forecast' ? measurements(raw.daily, 'precipitation_probability_max', d, 0, 100) : [],
      wind_speed_10m_max: measurements(raw.daily, 'wind_speed_10m_max', d, 0, 500),
      weathercode: measurements(raw.daily, 'weathercode', d, 0, 99),
    },
  };
}

export const openmeteo = {
  async getRaceWeather(input: GetRaceWeatherInput): Promise<RaceWeather | null> {
    if (!input || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 ||
      !Number.isFinite(input.lon) || Math.abs(input.lon) > 180) {
      return failOr('openmeteo', new ProviderError('openmeteo', 'invalid-input'), input?.strict, null);
    }
    const start = parseDate(input.dateStart);
    const end = parseDate(input.dateEnd);
    if (start === null || end === null || end < start || end - start > 30 * 86_400_000) {
      return failOr('openmeteo', new ProviderError('openmeteo', 'invalid-input'), input.strict, null);
    }
    const source = pickWeatherSource(start, end, input.now ?? Date.now());
    if (source === 'none') return null;
    const forecast = source === 'forecast';
    // A configured commercial account uses its reserved endpoint. A rejected
    // customer key must not silently switch the product to noncommercial access.
    const apiKey = process.env['OPENMETEO_API_KEY']?.trim();
    const url = new URL(apiKey
      ? (forecast ? CUSTOMER_FORECAST_BASE : CUSTOMER_ARCHIVE_BASE)
      : (forecast ? FORECAST_BASE : ARCHIVE_BASE));
    if (apiKey) url.searchParams.set('apikey', apiKey);
    url.searchParams.set('latitude', String(input.lat));
    url.searchParams.set('longitude', String(input.lon));
    // The daily block covers the circuit's local days, so pad the UTC window by a
    // day each side: a Las Vegas Thursday-night session is Friday in UTC.
    url.searchParams.set('start_date', new Date(start - DAY_MS).toISOString().slice(0, 10));
    url.searchParams.set('end_date', new Date(end + DAY_MS).toISOString().slice(0, 10));
    url.searchParams.set('hourly', [...HOURLY, ...(forecast ? ['precipitation_probability'] : [])].join(','));
    url.searchParams.set('daily', [...DAILY, ...(forecast ? ['precipitation_probability_max'] : [])].join(','));
    // Race-day totals (min/max air temperature, rain) are for the circuit's local
    // day, not the GMT day; hourly rows come back as exact UTC instants.
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('timeformat', 'unixtime');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('temperature_unit', 'celsius');
    url.searchParams.set('precipitation_unit', 'mm');
    const defaultRevalidate = forecast ? 3600 : 604_800;
    const revalidate = Number.isFinite(input.revalidate) && input.revalidate! >= 60
      ? Math.min(input.revalidate!, 2_592_000) : defaultRevalidate;
    const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs! > 0
      ? Math.min(input.timeoutMs!, 15_000) : 8_000;
    try {
      const raw = await requestJson('openmeteo', url, {
        headers: { Accept: 'application/json' }, next: { revalidate, tags: [WEATHER_CACHE_TAG, `weather:${source}`] },
      } as RequestInit, { fetchImpl: input.fetchImpl, signal: input.signal, timeoutMs, maxBytes: 512_000 });
      const weather = normalize(raw, source, input);
      if (!weather) throw new ProviderError('openmeteo', 'invalid-response');
      return weather;
    } catch (error) {
      return failOr('openmeteo', error, input.strict, null);
    }
  },
};
