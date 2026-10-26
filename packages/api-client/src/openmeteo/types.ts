/**
 * Open-Meteo raw response types.
 *
 * Two endpoints in play:
 *   - Forecast:   https://api.open-meteo.com/v1/forecast
 *   - Archive:    https://archive-api.open-meteo.com/v1/archive
 *
 * Public endpoints are rate-limited and intended for noncommercial use.
 * Commercial deployments require an appropriate provider plan/endpoint.
 * Requested measurements may be null when the provider has no observation.
 *
 * We only ever ask for hourly + daily blocks. We do NOT use current_weather
 * because it is unreliable for archival queries.
 */

/** Raw forecast/archive envelope. Fields are present iff requested via query. */
export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  /** Generation time in milliseconds · diagnostic, not used. */
  generationtime_ms?: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  elevation: number;
  hourly_units?: OpenMeteoHourlyUnits;
  hourly?: OpenMeteoHourly;
  daily_units?: OpenMeteoDailyUnits;
  daily?: OpenMeteoDaily;
  error?: boolean;
  reason?: string;
}

export interface OpenMeteoHourlyUnits {
  time: string;
  temperature_2m: string;
  precipitation: string;
  precipitation_probability?: string;
  wind_speed_10m: string;
  wind_direction_10m: string;
  weathercode: string;
}

export interface OpenMeteoHourly {
  /** ISO timestamps in the requested timezone (this client requests GMT). */
  time: string[];
  /** Celsius. */
  temperature_2m: Array<number | null>;
  /** Millimetres. */
  precipitation: Array<number | null>;
  /** Percent. Only available on forecast endpoint. */
  precipitation_probability?: Array<number | null>;
  /** kph (we request km/h). */
  wind_speed_10m: Array<number | null>;
  /** Degrees true. */
  wind_direction_10m: Array<number | null>;
  /** WMO weather code (0-99). */
  weathercode: Array<number | null>;
}

export interface OpenMeteoDailyUnits {
  time: string;
  temperature_2m_max: string;
  temperature_2m_min: string;
  precipitation_sum: string;
  precipitation_probability_max?: string;
  wind_speed_10m_max: string;
  weathercode: string;
}

export interface OpenMeteoDaily {
  /** YYYY-MM-DD in requested timezone. */
  time: string[];
  temperature_2m_max: Array<number | null>;
  temperature_2m_min: Array<number | null>;
  precipitation_sum: Array<number | null>;
  precipitation_probability_max?: Array<number | null>;
  wind_speed_10m_max: Array<number | null>;
  weathercode: Array<number | null>;
}

/** Which Open-Meteo backend we hit for a given query. */
export type OpenMeteoSource = 'forecast' | 'archive' | 'none';

/**
 * Trimmed shape returned by client.getRaceWeather().
 * Includes only the slices we actually use downstream.
 */
export interface RaceWeather {
  source: OpenMeteoSource;
  latitude: number;
  longitude: number;
  timezone: string;
  /** Offset supplied by the provider. New requests use GMT (zero). */
  utcOffsetSeconds?: number;
  hourly: {
    time: string[];
    temperature_2m: Array<number | null>;
    precipitation: Array<number | null>;
    /** Percent (0-100). Forecast only; archive yields []. */
    precipitation_probability: Array<number | null>;
    wind_speed_10m: Array<number | null>;
    wind_direction_10m: Array<number | null>;
    weathercode: Array<number | null>;
  };
  daily: {
    time: string[];
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
    precipitation_sum: Array<number | null>;
    /** Percent (0-100). Forecast only; archive yields []. */
    precipitation_probability_max: Array<number | null>;
    wind_speed_10m_max: Array<number | null>;
    weathercode: Array<number | null>;
  };
}
