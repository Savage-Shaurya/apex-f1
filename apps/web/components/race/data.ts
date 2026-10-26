import { jolpica, type JolpicaPitStopEntry, type JolpicaQualifyingEntry, type JolpicaResultEntry, type UiRace } from '@apex/api-client/jolpica';
import { openf1, type OpenF1Session } from '@apex/api-client/openf1';
import { openmeteo, mapRaceWeather, raceWeatherDateBounds, bucketFromWeathercode, bucketLabel, type SessionKind } from '@apex/api-client/openmeteo';
import { readPublicSport, SPORT_READ_OPTIONS, type PublicRead } from '@/lib/public-sport';
import { getGrid, getStandingsSeason } from '@/lib/grid';
import { raceReadTtlSeconds } from '@/lib/data-freshness';

/**
 * Page-level reads for /schedule/[season]/[race]. Every read keeps the
 * difference between "the provider answered with nothing" and "the provider
 * could not be reached", so each panel can say which one it is.
 */

/** Jolpica publishes pit stops from 2011 and lap times from 1996. */
export const PIT_STOPS_FROM = 2011;
/** OpenF1's historical archive starts with the 2023 season. */
export const OPENF1_FROM = 2023;

export type SessionRead<T> = PublicRead<T> | { state: 'not-run' } | { state: 'not-covered' };

export interface WeekendExtras {
  qualifying: SessionRead<JolpicaQualifyingEntry[]>;
  sprint: SessionRead<JolpicaResultEntry[]>;
  pitStops: SessionRead<JolpicaPitStopEntry[]>;
  /** OpenF1 sessions of this meeting (end times, cancellations, track time zone). */
  openf1Sessions: OpenF1Session[];
  /** Headshots for the live standings season only (F1 media CDN via lib/grid). */
  headshots: Map<string, { src: string | null; color: string }>;
}

function startedBefore(iso: string | undefined, now: number): boolean {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && t <= now;
}

export async function loadWeekendExtras(race: UiRace, now: number, raceHasResults: boolean): Promise<WeekendExtras> {
  const q = race.sessions.find((s) => s.kind === 'Q');
  const s = race.sessions.find((x) => x.kind === 'S');
  // 60 s during the weekend, then slower as the race becomes history (lib/data-freshness).
  const opts = { ...SPORT_READ_OPTIONS, revalidate: raceReadTtlSeconds(race, now) };

  const [qualifying, sprint, pitStops, sessions, headshots] = await Promise.all([
    // Old seasons have no session times in Jolpica; ask whenever the race itself has run.
    startedBefore(q?.iso, now) || startedBefore(race.raceStartIso, now)
      ? readPublicSport(() => jolpica.getQualifyingFull(race.season, race.round, opts))
      : Promise.resolve({ state: 'not-run' as const }),
    s
      ? startedBefore(s.iso, now)
        ? readPublicSport(() => jolpica.getSprint(race.season, race.round, opts))
        : Promise.resolve({ state: 'not-run' as const })
      : Promise.resolve({ state: 'not-covered' as const }),
    race.season < PIT_STOPS_FROM
      ? Promise.resolve({ state: 'not-covered' as const })
      : raceHasResults
        ? readPublicSport(() => jolpica.getPitStops(race.season, race.round, { ...opts, revalidate: 86_400 }))
        : Promise.resolve({ state: 'not-run' as const }),
    race.season >= OPENF1_FROM ? meetingSessions(race) : Promise.resolve([] as OpenF1Session[]),
    headshotsFor(race.season),
  ]);
  return { qualifying, sprint, pitStops, openf1Sessions: sessions, headshots };
}

/** The OpenF1 rows that belong to this weekend (matched by start time, never by name). */
async function meetingSessions(race: UiRace): Promise<OpenF1Session[]> {
  try {
    // OpenF1 refuses free reads while a session is live: fall back to the last good copy of this same list.
    const rows = await openf1.getSessionsForYear(race.season, { strict: true, revalidate: 3600, lastGood: 'fallback' });
    const starts = race.sessions.map((s) => Date.parse(s.iso)).filter(Number.isFinite);
    const match = rows.find((row) => starts.some((t) => Math.abs(Date.parse(row.date_start) - t) <= 20 * 60_000));
    return match ? rows.filter((row) => row.meeting_key === match.meeting_key) : [];
  } catch {
    // OpenF1 adds end times and track time only; the weekend renders without them.
    return [];
  }
}

async function headshotsFor(season: number): Promise<Map<string, { src: string | null; color: string }>> {
  try {
    const live = await getStandingsSeason();
    if (live.season !== season) return new Map();
    const grid = await getGrid();
    return new Map(grid.map((d) => [d.slug, { src: d.headshot, color: d.color }]));
  } catch {
    return new Map();
  }
}

/* ------------------------------------------------------------ session weather */

export interface SessionWeather {
  airC: number | null;
  /** Forecast chance (%), only for sessions still ahead. */
  rainPct: number | null;
  /** Rain that fell (mm), for sessions that have run. */
  rainMm: number | null;
  sky: string | null;
  /** True when the values describe hours that have passed (recorded or model analysis), false for a forecast. */
  recorded: boolean;
}

/**
 * Weather for each session of the weekend, keyed by kind + start, for the
 * session timeline. The same read the conditions panel makes (deduplicated
 * by the fetch cache). Null when the weekend is outside the forecast or
 * archive window, or the read failed: the timeline then simply leaves it out.
 */
export async function loadSessionWeather(race: UiRace, sessions: ReadonlyArray<{ kind: string; iso: string }>, now: number): Promise<Map<string, SessionWeather> | null> {
  if (!Number.isFinite(race.lat) || !Number.isFinite(race.lon)) return null;
  try {
    const KINDS = new Set(['FP1', 'FP2', 'FP3', 'Q', 'R', 'S', 'SQ']);
    const typed = sessions.filter((s) => KINDS.has(s.kind) && s.iso.includes('T')).map((s) => ({ kind: s.kind as SessionKind, iso: s.iso }));
    if (!typed.length) return null;
    const raceIso = sessions.find((s) => s.kind === 'R')?.iso ?? race.raceStartIso;
    const { start, end } = raceWeatherDateBounds(typed, raceIso);
    const raw = await openmeteo.getRaceWeather({ lat: race.lat, lon: race.lon, dateStart: start, dateEnd: end, revalidate: 3600, now });
    if (!raw) return null;
    const ui = mapRaceWeather({ weather: raw, sessions: typed, raceStartIso: raceIso });
    const archive = ui.source === 'archive';
    const out = new Map<string, SessionWeather>();
    for (const s of ui.sessions) {
      const t = Date.parse(s.iso);
      const recorded = archive || (Number.isFinite(t) && t + 7_200_000 <= now);
      const sky = bucketFromWeathercode(s.weathercode);
      out.set(s.kind + s.iso, {
        airC: s.peakAirTempC,
        rainPct: recorded ? null : s.precipitationProbabilityPct,
        rainMm: recorded ? s.precipitationMm : null,
        sky: sky === 'unknown' ? null : bucketLabel(sky),
        recorded,
      });
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}
