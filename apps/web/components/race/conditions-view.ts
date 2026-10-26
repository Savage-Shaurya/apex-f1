import { bucketFromWeathercode, bucketLabel, type UiRaceWeather, type UiSessionWeather } from '@apex/api-client/openmeteo';
import { sessionName } from './weekend';

/* ---------------------------------------------------------------------------
 * Words for the conditions panel, built from Open-Meteo values per session.
 *
 * The provider's own headline folds every session's risk into one flag, so
 * a wet Sprint made a dry race read "Heavy rain risk" (critic, Singapore
 * 2026). Here each statement is tied to the session it describes:
 *  - the headline is the race session's own sky (else the race-day code);
 *  - rain in other sessions is named with that session;
 *  - recorded values are stated as facts, forecasts as chances, decided per
 *    session: during a live weekend the forecast feed carries the model's
 *    analysis of hours already past, so a session that has run is stated in
 *    millimetres, never as a "chance" (critic, R18 2026);
 *  - units match the stat tiles (°C, km/h, mm).
 * ------------------------------------------------------------------------- */

/** Recorded rain below this (mm in a session) is a trace and not called out. */
const WET_SESSION_MM = 0.5;
/** Forecast chance at or above this (%) is called out for a session. */
const WET_SESSION_PCT = 50;
/** Race-day total above this (mm) is called heavy (product heuristic, not an FIA threshold). */
const HEAVY_DAY_MM = 5;

export interface ConditionsView {
  /** "During the race", "Race forecast", "Race day", "Race-day forecast", or "Weekend". */
  basis: string;
  headline: string;
  /** One line of supporting numbers, e.g. "Air 27–32 °C on race day · wind up to 11 km/h". */
  summary: string | null;
  /** Rain during the race itself, stated for that session only. */
  raceRain: string | null;
  /** Other sessions with rain, each named. */
  wetSessions: string[];
  /** Under the race-day rain tile: only for the race-day total itself. */
  raceDayFlag: string | null;
}

/** A session counts as run two hours after its start (a date-only start: the next day). */
export function sessionHasRun(iso: string, now: number): boolean {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const t = Date.parse(dateOnly ? `${iso}T00:00:00Z` : iso);
  return Number.isFinite(t) && t + (dateOnly ? 86_400_000 : 7_200_000) <= now;
}

/** Recorded (archive) or already run (model analysis): state amounts, not chances. */
export function statedAsFact(s: Pick<UiSessionWeather, 'iso'>, recorded: boolean, now: number | undefined): boolean {
  return recorded || (now != null && sessionHasRun(s.iso, now));
}

/** The rain clause on a session tile: "2.4 mm of rain", "no rain", "40% chance of rain", or nothing. */
export function sessionRainClause(s: UiSessionWeather, fact: boolean): string | null {
  if (fact) {
    if (s.precipitationMm == null) return null;
    return s.precipitationMm >= 0.05 ? `${s.precipitationMm.toFixed(1)} mm of rain` : 'no rain';
  }
  return s.precipitationProbabilityPct != null ? `${s.precipitationProbabilityPct}% chance of rain` : null;
}

function rainText(s: UiSessionWeather, recorded: boolean): string | null {
  if (recorded) return s.precipitationMm != null && s.precipitationMm >= WET_SESSION_MM ? `${s.precipitationMm.toFixed(1)} mm` : null;
  return s.precipitationProbabilityPct != null && s.precipitationProbabilityPct >= WET_SESSION_PCT ? `${s.precipitationProbabilityPct}% chance of rain` : null;
}

export function conditionsView(ui: Pick<UiRaceWeather, 'sessions' | 'raceDay'>, recorded: boolean, now?: number): ConditionsView {
  const race = ui.sessions.find((s) => s.kind === 'R') ?? null;
  const fact = (s: UiSessionWeather) => statedAsFact(s, recorded, now);
  const raceFact = race ? fact(race) : recorded;
  const raceSky = bucketFromWeathercode(race?.weathercode);
  const daySky = bucketFromWeathercode(ui.raceDay?.weathercode);

  let basis: string;
  let headline: string;
  if (raceSky !== 'unknown') {
    basis = raceFact ? 'During the race' : 'Race forecast';
    headline = raceSky === 'thunderstorm' && !raceFact ? 'Thunderstorm risk' : bucketLabel(raceSky);
  } else if (daySky !== 'unknown') {
    basis = raceFact ? 'Race day' : 'Race-day forecast';
    headline = daySky === 'thunderstorm' && !raceFact ? 'Thunderstorm risk' : bucketLabel(daySky);
  } else {
    basis = 'Weekend';
    headline = 'Sky not reported';
  }

  const lo = ui.raceDay?.minAirTempC;
  const hi = ui.raceDay?.maxAirTempC;
  const air = lo != null && hi != null ? `Air ${Math.round(lo)}–${Math.round(hi)} °C on race day` : hi != null ? `Air up to ${Math.round(hi)} °C on race day` : race?.peakAirTempC != null ? `Air ${Math.round(race.peakAirTempC)} °C during the race` : null;
  const windKph = ui.raceDay?.peakWindKph ?? race?.peakWindKph ?? null;
  const wind = windKph != null ? `wind up to ${windKph} km/h` : null;
  const summary = [air, wind].filter(Boolean).join(' · ') || null;

  const raceRainValue = race ? rainText(race, raceFact) : null;
  const raceRain = raceRainValue ? (raceFact ? `${raceRainValue} of rain fell during the race` : `${raceRainValue} during the race`) : null;

  const wetSessions = ui.sessions
    .filter((s) => s.kind !== 'R')
    .map((s) => ({ s, text: rainText(s, fact(s)) }))
    .filter((x): x is { s: UiSessionWeather; text: string } => x.text != null)
    .map(({ s, text }) => `${sessionName(s.kind)}: ${text}`);

  const total = ui.raceDay?.totalPrecipitationMm ?? null;
  const raceDayFlag = daySky === 'thunderstorm'
    ? (raceFact ? 'Thunderstorms recorded that day' : 'Thunderstorms possible')
    : total != null && total > HEAVY_DAY_MM
      ? (raceFact ? `Heavy rain that day (over ${HEAVY_DAY_MM} mm)` : 'Heavy rain possible')
      : null;

  return { basis, headline, summary, raceRain, wetSessions, raceDayFlag };
}
