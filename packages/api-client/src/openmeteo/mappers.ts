import type { RaceWeather } from './types';

/**
 * UI-facing weather shapes.
 *
 * We never ship raw hourly arrays to the client. The mapper collapses
 * them to per-session peaks + a race-day cumulative + risk flags.
 *
 * Open-Meteo reports air conditions only. Track (asphalt) temperature is
 * never derived here: measured track readings come from the official timing
 * feed (OpenF1 /weather) after a session, never from a model or offset.
 */

export type SessionKind = 'FP1' | 'FP2' | 'FP3' | 'Q' | 'R' | 'S' | 'SQ';

export interface UiSessionWeather {
  kind: SessionKind;
  /** ISO start of the session (passed in by caller). */
  iso: string;
  /** Peak air temp (C) across the session window. null if no data. */
  peakAirTempC: number | null;
  /** 0-100. Forecast only; null on archive or no data. */
  precipitationProbabilityPct: number | null;
  /** Sum of precipitation across session window (mm). */
  precipitationMm: number | null;
  /** Peak wind (km/h). */
  peakWindKph: number | null;
  /** Circular mean wind direction (deg true). null if absent/cancelling. */
  windDirectionDeg: number | null;
  /** Dominant WMO weather code over the session window. */
  weathercode: number | null;
}

export interface UiRaceDayWeather {
  /** YYYY-MM-DD: the circuit's local calendar day (Open-Meteo timezone=auto). */
  date: string;
  maxAirTempC: number | null;
  minAirTempC: number | null;
  totalPrecipitationMm: number | null;
  peakWindKph: number | null;
  weathercode: number | null;
}

export interface UiWeatherRisks {
  heavyRain: boolean | null;
  extremeHeat: boolean | null;
  highWind: boolean | null;
  thunderstorm: boolean | null;
}

export interface UiWeatherCondition {
  /** Icon/colour bucket. Risk flags override the sky code (storm, heavy rain). */
  bucket: WeatherBucket;
  /** The single headline phrase shared by the panel heading and the summary. */
  label: string;
  /** Where the sky code came from: the race session window, the race-day daily code, or nowhere. */
  basis: 'race-session' | 'race-day' | 'none';
}

export interface UiRaceWeather {
  source: RaceWeather['source'];
  /** One headline condition; the summary line starts with the same label. */
  condition: UiWeatherCondition;
  /** True for archive data or a finished race: wording must describe what happened, not a forecast. */
  observed: boolean;
  sessions: UiSessionWeather[];
  raceDay: UiRaceDayWeather | null;
  risks: UiWeatherRisks;
  /** Missing observations are distinguishable from a verified dry forecast. */
  availability: 'available' | 'partial' | 'unavailable';
  /** One-line summary of known observations, or "Conditions unavailable". */
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// WMO weathercode → bucket. Per spec:
//   0      clear
//   1      mainly clear
//   2      partly cloudy
//   3      overcast
//   45/48  fog
//   51-67  rain (drizzle + rain)
//   71-77  snow
//   95-99  thunderstorm
// ─────────────────────────────────────────────────────────────────────────────

export type WeatherBucket =
  | 'clear'
  | 'mainly_clear'
  | 'partly_cloudy'
  | 'overcast'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export function bucketFromWeathercode(code: number | null | undefined): WeatherBucket {
  if (code == null || !Number.isInteger(code)) return 'unknown';
  if (code === 0) return 'clear';
  if (code === 1) return 'mainly_clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67].includes(code)) return 'rain';
  if ([71, 73, 75, 77].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  // 80-82 = rain showers, 85-86 = snow showers · fold into rain/snow.
  if (code >= 80 && code <= 82) return 'rain';
  if (code === 85 || code === 86) return 'snow';
  return 'unknown';
}

/** Pretty short label for a bucket. */
export function bucketLabel(b: WeatherBucket): string {
  switch (b) {
    case 'clear':
      return 'Clear';
    case 'mainly_clear':
      return 'Mainly clear';
    case 'partly_cloudy':
      return 'Partly cloudy';
    case 'overcast':
      return 'Overcast';
    case 'fog':
      return 'Fog';
    case 'rain':
      return 'Rain';
    case 'snow':
      return 'Snow';
    case 'thunderstorm':
      return 'Thunderstorm';
    default:
      return 'Unknown';
  }
}

/** Material Symbols icon name per bucket. */
export function bucketIcon(b: WeatherBucket): string {
  switch (b) {
    case 'clear':
      return 'wb_sunny';
    case 'mainly_clear':
      return 'partly_cloudy_day';
    case 'partly_cloudy':
      return 'partly_cloudy_day';
    case 'overcast':
      return 'cloud';
    case 'fog':
      return 'foggy';
    case 'rain':
      return 'rainy';
    case 'snow':
      return 'weather_snowy';
    case 'thunderstorm':
      return 'thunderstorm';
    default:
      return 'cloud';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers · pure, side-effect free.
// ─────────────────────────────────────────────────────────────────────────────

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const EXPLICIT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

function formatter(timezone: string): Intl.DateTimeFormat | null {
  try {
    let value = timeFormatters.get(timezone);
    if (!value) {
      value = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
      if (timeFormatters.size >= 16) timeFormatters.clear();
      timeFormatters.set(timezone, value);
    }
    return value;
  } catch { return null; }
}

function wallClock(timestamp: number, timezone: string): number | null {
  const fmt = formatter(timezone);
  if (!fmt) return null;
  const parts = Object.fromEntries(fmt.formatToParts(timestamp).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/** Interpret old local-time cache entries without relying on the host timezone. */
function instant(value: string, weather: RaceWeather): number | null {
  if (EXPLICIT_INSTANT.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const naive = Date.parse(`${value}Z`);
  if (!Number.isFinite(naive)) return null;
  if (Number.isFinite(weather.utcOffsetSeconds)) return naive - weather.utcOffsetSeconds! * 1000;
  if (['GMT', 'UTC', 'Etc/GMT', 'Etc/UTC'].includes(weather.timezone)) return naive;
  // Legacy normalized data omitted the offset. Resolve the IANA zone at each
  // instant, including DST; nonexistent local times remain unknown.
  let guess = naive;
  for (let attempt = 0; attempt < 3; attempt++) {
    const local = wallClock(guess, weather.timezone);
    if (local === null) return null;
    const next = guess + naive - local;
    if (next === guess) return guess;
    guess = next;
  }
  return wallClock(guess, weather.timezone) === naive ? guess : null;
}

/** Hourly indices in the session's UTC [-1h,+3h] observation window. */
function indicesForSession(
  hourlyTime: string[],
  sessionIso: string,
  weather: RaceWeather,
): number[] {
  // A calendar date cannot supply an observation window. Require both an
  // actual clock time and explicit zone instead of inventing a midnight start.
  if (!EXPLICIT_INSTANT.test(sessionIso)) return [];
  const start = Date.parse(sessionIso);
  if (!Number.isFinite(start)) return [];
  // Sessions span ≤2h normally; we widen to 3h to catch overrun + alignment.
  const end = start + 3 * 60 * 60 * 1000;
  const out: number[] = [];
  for (let i = 0; i < hourlyTime.length; i++) {
    const ts = hourlyTime[i];
    if (!ts) continue;
    const t = instant(ts, weather);
    if (t !== null && t >= start - 60 * 60 * 1000 && t <= end) {
      out.push(i);
    }
  }
  return out;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function measured(value: unknown, min: number, max: number): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : null;
}

function max(xs: Array<number | null>): number | null {
  const values = xs.filter((x): x is number => finite(x) !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/** A missing hour prevents an incomplete sum being advertised as a full total. */
function sum(xs: Array<number | null>): number | null {
  if (xs.length === 0 || xs.some((x) => finite(x) === null)) return null;
  return xs.reduce<number>((total, x) => total + x!, 0);
}

/** Most common value, ties broken by first occurrence. */
function mode(raw: Array<number | null>): number | null {
  const xs = raw.filter((x): x is number => bucketFromWeathercode(x) !== 'unknown');
  if (xs.length === 0) return null;
  const counts = new Map<number, number>();
  let best = xs[0]!;
  let bestN = 0;
  for (const x of xs) {
    const n = (counts.get(x) ?? 0) + 1;
    counts.set(x, n);
    if (n > bestN) {
      bestN = n;
      best = x;
    }
  }
  return best;
}

function pick(arr: Array<number | null>, idxs: number[], min = -Infinity, max = Infinity): Array<number | null> {
  return idxs.map((index) => measured(arr[index], min, max));
}

function circularMean(raw: Array<number | null>): number | null {
  const values = raw.filter((value): value is number => finite(value) !== null && value! >= 0 && value! <= 360);
  if (values.length === 0) return null;
  const sine = values.reduce((total, deg) => total + Math.sin(deg * Math.PI / 180), 0);
  const cosine = values.reduce((total, deg) => total + Math.cos(deg * Math.PI / 180), 0);
  if (Math.hypot(sine, cosine) / values.length < 1e-6) return null;
  return Math.round((Math.atan2(sine, cosine) * 180 / Math.PI + 360) % 360) % 360;
}

function exceeds(value: number | null | undefined, threshold: number): boolean | null {
  return value == null ? null : value >= threshold;
}

function anyRisk(values: Array<boolean | null>): boolean | null {
  if (values.some((value) => value === true)) return true;
  return values.length > 0 && values.every((value) => value === false) ? false : null;
}

function storm(code: number | null | undefined): boolean | null {
  const bucket = bucketFromWeathercode(code);
  return bucket === 'unknown' ? null : bucket === 'thunderstorm';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main mapper.
// ─────────────────────────────────────────────────────────────────────────────

export interface MapRaceWeatherInput {
  weather: RaceWeather;
  /** Sessions ordered as caller sees them. */
  sessions: Array<{ kind: SessionKind; iso: string }>;
  /** ISO of the race start · used to lock onto the daily row. */
  raceStartIso: string;
  /**
   * Request time. When the race has finished (or the source is the archive),
   * labels describe what happened ("Heavy rain") instead of a forecast risk.
   */
  now?: number;
}

export function mapRaceWeather(input: MapRaceWeatherInput): UiRaceWeather {
  const { weather, sessions, raceStartIso } = input;

  // ── Per-session collapse ────────────────────────────────────────────────
  const uiSessions: UiSessionWeather[] = sessions.map((s) => {
    const idxs = indicesForSession(weather.hourly.time, s.iso, weather);
    const peakAir = max(pick(weather.hourly.temperature_2m, idxs, -100, 100));
    const precip = sum(pick(weather.hourly.precipitation, idxs, 0, 2000));
    const probArr = pick(weather.hourly.precipitation_probability, idxs, 0, 100);
    const peakWind = max(pick(weather.hourly.wind_speed_10m, idxs, 0, 500));
    const dirArr = pick(weather.hourly.wind_direction_10m, idxs);
    const codeArr = pick(weather.hourly.weathercode, idxs);

    return {
      kind: s.kind,
      iso: s.iso,
      peakAirTempC: peakAir,
      precipitationProbabilityPct: probArr.length > 0 ? max(probArr) : null,
      precipitationMm: precip === null ? null : Math.round(precip * 10) / 10,
      peakWindKph: peakWind == null ? null : Math.round(peakWind),
      windDirectionDeg: circularMean(dirArr),
      weathercode: mode(codeArr),
    };
  });

  // ── Race-day cumulative ─────────────────────────────────────────────────
  const raceInstant = instant(raceStartIso, weather);
  const localInstant = raceInstant === null ? null : wallClock(raceInstant, weather.timezone);
  const raceDate = localInstant === null ? '' : new Date(localInstant).toISOString().slice(0, 10);
  const dailyIdx = weather.daily.time.indexOf(raceDate);
  let raceDay: UiRaceDayWeather | null = null;
  if (dailyIdx >= 0) {
    raceDay = {
      date: raceDate,
      maxAirTempC: measured(weather.daily.temperature_2m_max[dailyIdx], -100, 100),
      minAirTempC: measured(weather.daily.temperature_2m_min[dailyIdx], -100, 100),
      totalPrecipitationMm:
        measured(weather.daily.precipitation_sum[dailyIdx], 0, 10000) === null ? null : Math.round(weather.daily.precipitation_sum[dailyIdx]! * 10) / 10,
      peakWindKph: measured(weather.daily.wind_speed_10m_max[dailyIdx], 0, 500) !== null
        ? Math.round(weather.daily.wind_speed_10m_max[dailyIdx]!)
        : null,
      weathercode: bucketFromWeathercode(weather.daily.weathercode[dailyIdx]) === 'unknown' ? null : weather.daily.weathercode[dailyIdx]!,
    };
  }

  // ── Risk flags ──────────────────────────────────────────────────────────
  // Product-level heuristics, not FIA thresholds or official safety advice.
  const heavyRain = anyRisk([
    exceeds(raceDay?.totalPrecipitationMm, 5),
    ...uiSessions.flatMap((s) => [exceeds(s.precipitationMm, 2),
      ...(weather.source === 'forecast' ? [exceeds(s.precipitationProbabilityPct, 70)] : [])]),
  ]);
  const extremeHeat = exceeds(raceDay?.maxAirTempC, 32);
  const highWind = anyRisk([exceeds(raceDay?.peakWindKph, 30), ...uiSessions.map((s) => exceeds(s.peakWindKph, 35))]);
  const thunderstorm = anyRisk([storm(raceDay?.weathercode), ...uiSessions.map((s) => storm(s.weathercode))]);

  // ── Headline condition + summary line (one source for both) ─────────────
  const risks = { heavyRain, extremeHeat, highWind, thunderstorm };
  const raceStart = Date.parse(raceStartIso);
  const observed = weather.source === 'archive' || (input.now !== undefined && Number.isFinite(raceStart) && input.now >= raceStart + 2 * 3_600_000);
  const condition = headlineCondition(raceDay, uiSessions, risks, observed ? 'observed' : 'forecast');
  const summary = buildSummary({ raceDay, uiSessions, condition });

  return {
    source: weather.source,
    condition,
    observed,
    sessions: uiSessions,
    raceDay,
    risks: { heavyRain, extremeHeat, highWind, thunderstorm },
    availability: weatherAvailability(raceDay, uiSessions, weather.source === 'forecast'),
    summary,
  };
}

/** The race session's own window only; another session never sets the race heading. */
function headlineSession(uiSessions: UiSessionWeather[]): UiSessionWeather | null {
  return uiSessions.find((s) => s.kind === 'R') ?? null;
}

/**
 * One headline for the whole panel. The race session's hourly sky code is the
 * most relevant reading; the daily code (Open-Meteo reports the day's most
 * severe code) is used only when the session window has none. Storm and heavy
 * rain risks take precedence so the heading never reads "Clear" over a storm.
 */
export function headlineCondition(
  raceDay: UiRaceDayWeather | null,
  uiSessions: UiSessionWeather[],
  risks: UiWeatherRisks,
  /** 'observed' for finished races and archive data: past-tense, no "risk"/"expected". */
  tense: 'forecast' | 'observed' = 'forecast',
): UiWeatherCondition {
  const session = headlineSession(uiSessions);
  const sessionBucket = bucketFromWeathercode(session?.weathercode);
  const dayBucket = bucketFromWeathercode(raceDay?.weathercode);
  const basis: UiWeatherCondition['basis'] = sessionBucket !== 'unknown' ? 'race-session' : dayBucket !== 'unknown' ? 'race-day' : 'none';
  const sky = sessionBucket !== 'unknown' ? sessionBucket : dayBucket;
  let bucket: WeatherBucket = sky;
  let label: string;
  if (risks.thunderstorm === true) { bucket = 'thunderstorm'; label = tense === 'observed' ? 'Thunderstorms' : 'Thunderstorm risk'; }
  else if (risks.heavyRain === true) { bucket = 'rain'; label = tense === 'observed' ? 'Heavy rain' : 'Heavy rain risk'; }
  else if (sky !== 'unknown') label = bucketLabel(sky);
  else label = 'Conditions unavailable';
  if (risks.extremeHeat === true && label !== 'Conditions unavailable') label += ', hot';
  return { bucket, label, basis };
}

function buildSummary(args: {
  raceDay: UiRaceDayWeather | null;
  uiSessions: UiSessionWeather[];
  condition: UiWeatherCondition;
}): string {
  const { raceDay, uiSessions, condition } = args;
  const headline = headlineSession(uiSessions);
  const lede = condition.label;

  // Temp band.
  const lo = raceDay?.minAirTempC;
  const hi = raceDay?.maxAirTempC;
  const tempPart =
    lo != null && hi != null
      ? `${Math.round(lo)}-${Math.round(hi)}C`
      : hi != null
        ? `${Math.round(hi)}C`
        : headline?.peakAirTempC != null
          ? `${Math.round(headline.peakAirTempC)}C`
          : null;

  // Wind band.
  const wind = raceDay?.peakWindKph ?? headline?.peakWindKph ?? null;
  let windPart: string | null = null;
  if (wind != null) {
    const label = wind >= 35 ? 'gusting wind' : wind >= 20 ? 'breezy' : 'light wind';
    windPart = `${label} ${wind}kph`;
  }

  return [lede, tempPart, windPart].filter((x): x is string => Boolean(x)).join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: cardinal direction from degrees (used by WeatherStrip).
// ─────────────────────────────────────────────────────────────────────────────

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function cardinalFromDeg(deg: number | null): string {
  if (deg == null || !Number.isFinite(deg)) return '-';
  const i = Math.round(((deg % 360 + 360) % 360) / 45) % 8;
  return CARDINALS[i] ?? 'N';
}

function weatherAvailability(day: UiRaceDayWeather | null, sessions: UiSessionWeather[], forecast: boolean): UiRaceWeather['availability'] {
  const values = [day?.maxAirTempC, day?.minAirTempC, day?.totalPrecipitationMm, day?.peakWindKph, day?.weathercode,
    ...sessions.flatMap((s) => [s.peakAirTempC, s.precipitationMm, s.peakWindKph, s.windDirectionDeg, s.weathercode,
      ...(forecast ? [s.precipitationProbabilityPct] : [])])];
  const present = values.filter((value) => finite(value) !== null).length;
  return present === 0 ? 'unavailable' : present === values.length ? 'available' : 'partial';
}
