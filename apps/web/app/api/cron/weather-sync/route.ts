/**
 * Weather sync cron.
 *
 * Fires every hour · pulls Open-Meteo forecast for the next 3 races on the
 * calendar so /schedule/[season]/[race] hero weather
 * always serve a fresh sample.
 *
 * Open-Meteo has provider limits and account/usage terms. This is cache priming,
 * limited to the provider's currently supported 14-day forecast horizon.
 *
 * The calendar barely changes: while Jolpica is unavailable the last validated
 * copy (up to 7 days old) is used and the report says so (`degraded`,
 * `results.calendar`). With no copy, or when Open-Meteo is unavailable for
 * every race, the run answers the provider-unavailable contract (503,
 * lib/cron-outcome.ts); any other failure stays HTTP 500.
 *
 * Schedule: hourly via .github/workflows/refresh-weather.yml.
 * Auth: Bearer CRON_SECRET only.
 */

import { NextResponse } from "next/server";
import { openmeteo, raceWeatherDateBounds } from "@apex/api-client/openmeteo";
import { refreshTagKeepingLastGood } from "@/lib/cache-refresh";
import {
  buildReport,
  isAuthorizedCronRequest,
  logReport,
  retry,
} from "@/lib/cron-auth";
import { safeErrorMessage } from "@/lib/api-input";
import { runLeasedCron } from '@/lib/leased-cron';
import {
  calendarReport,
  providerUnavailableResponse,
  readCronCalendar,
  unavailableProvider,
  type CronCalendar,
} from "@/lib/cron-outcome";
import type { JobContext } from '../../../../../workers/src/lib/job-control';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // Idempotent cache refresh: runs unleased when no database is configured.
  return runLeasedCron(req, 'weather-sync', (job) => synchronize(req, job), { lease: 'optional' });
}
async function synchronize(req: Request, job: JobContext) {
  const start = Date.now();

  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let upcoming: Array<{
    slug: string;
    season: number;
    lat: number;
    lon: number;
    date: string;
    start: string;
    end: string;
  }> = [];
  let outsideForecastHorizon = 0;
  let calendar: CronCalendar;
  try {
    calendar = await retry(
      () => readCronCalendar({ revalidate: 3600, signal: job.signal, deadlineMs: 15_000 }),
      { attempts: 2, deadlineMs: Math.min(30_000, job.remainingMs() - 5_000) },
    );
    const races = calendar.races;
    const now = Date.now();
    const horizonEnd =
      Date.parse(new Date(now).toISOString().slice(0, 10)) + 15 * 86_400_000;
    const future = races
      .filter((r) => new Date(r.raceStartIso).getTime() > now)
      .sort((a, b) => Date.parse(a.raceStartIso) - Date.parse(b.raceStartIso));
    outsideForecastHorizon = future.filter(
      (r) => Date.parse(r.raceStartIso) >= horizonEnd,
    ).length;
    upcoming = future
      .filter((r) => Date.parse(r.raceStartIso) < horizonEnd)
      .slice(0, 3)
      .map((r) => ({
        slug: r.slug,
        season: r.season,
        lat: r.lat,
        lon: r.lon,
        date: r.raceStartIso,
        ...raceWeatherDateBounds(r.sessions, r.raceStartIso),
      }));
  } catch (err) {
    const provider = unavailableProvider([err]);
    if (provider)
      return providerUnavailableResponse(start, {
        route: "weather-sync",
        provider,
        error: `schedule fetch failed: ${safeErrorMessage(err)}; no validated calendar copy is available. The next run retries.`,
      });
    const r = buildReport(start, {
      ok: false,
      route: "weather-sync",
      error: `schedule fetch failed: ${safeErrorMessage(err)}`,
    });
    logReport(r);
    return NextResponse.json(r, { status: 500 });
  }

  const reports = await Promise.all(
    upcoming.map(async (r) => {
      try {
        const day = r.date.slice(0, 10); // YYYY-MM-DD (race day)
        const weather = await openmeteo.getRaceWeather({
          lat: r.lat,
          lon: r.lon,
          dateStart: r.start,
          dateEnd: r.end,
          strict: true,
          signal: job.signal,
          timeoutMs: Math.max(1, Math.min(8_000, job.remainingMs() - 5_000)),
        });
        const dayIndex = weather?.daily.time.indexOf(day) ?? -1;
        if (
          !weather ||
          dayIndex < 0 ||
          weather.daily.temperature_2m_max[dayIndex] == null
        )
          throw new Error(
            "forecast unavailable or invalid for requested race day",
          );
        return {
          slug: r.slug,
          ok: true,
          availability:
            weather.daily.precipitation_sum[dayIndex] == null
              ? "partial"
              : "available",
        };
      } catch (err) {
        return {
          slug: r.slug,
          ok: false,
          error: safeErrorMessage(err),
          cause: err as unknown,
        };
      }
    }),
  );

  if (reports.some((r) => r.ok)) {
    try {
      // Historical archives keep their longer TTL; only near-term forecasts change hourly.
      // Refreshed after a validated read and stale-while-revalidate, never hard-expired
      // first, so a failing Open-Meteo read keeps the last good forecast (R3-BE-4).
      refreshTagKeepingLastGood("weather:forecast");
    } catch (err) {
      const report = buildReport(start, {
        ok: false,
        route: "weather-sync",
        error: `cache refresh: ${safeErrorMessage(err)}`,
      });
      logReport(report);
      return NextResponse.json(report, { status: 500 });
    }
  }

  const failures = reports.flatMap((r) => (r.ok ? [] : [r.cause]));
  const races = reports.map((r) => (r.ok ? r : { slug: r.slug, ok: false, error: r.error }));
  const { degraded: staleCalendar, calendar: calendarSource } = calendarReport(calendar);
  const results = { races, count: upcoming.length, outsideForecastHorizon, calendar: calendarSource };
  const forecastProvider = unavailableProvider(failures);
  // Open-Meteo unavailable for every race: nothing was refreshed, retry later.
  if (forecastProvider && !reports.some((r) => r.ok))
    return providerUnavailableResponse(start, {
      route: "weather-sync",
      provider: forecastProvider,
      error: "Forecast provider unavailable for every upcoming race; the last good forecasts stay cached. The next run retries.",
      results,
    });
  // Some forecasts refreshed, the rest failed only because the provider was unavailable: degraded success.
  const partialOutage = Boolean(forecastProvider);
  const final = {
    ...buildReport(start, {
      ok: failures.length === 0 || partialOutage,
      route: "weather-sync",
      results,
      ...(!upcoming.length
        ? { skipped: "No upcoming races are within the forecast horizon." }
        : {}),
    }),
    ...(staleCalendar || partialOutage ? { degraded: true } : {}),
  };
  logReport(final);
  return NextResponse.json(final, { status: final.ok ? 200 : 500 });
}
