import {
  openmeteo,
  mapRaceWeather,
  bucketFromWeathercode,
  bucketLabel,
  cardinalFromDeg,
  pickWeatherSource,
  raceWeatherDateBounds,
  type SessionKind,
} from '@apex/api-client/openmeteo';
import { SectionHead } from './SectionHead';
import { loadMeasuredTrackTemperatures, type MeasuredTrackTemp } from '@/lib/race-weekend/track-temperature';
import { sessionName } from './weekend';
import { ClockTime } from './SessionClock';
import { conditionsView, sessionRainClause, statedAsFact } from './conditions-view';

/**
 * Weekend conditions. Air, rain and wind come from Open-Meteo (a forecast
 * before the weekend, the historical archive after it, labelled as such).
 * Track temperature appears only as measured by the official timing feed
 * (OpenF1 /weather) for finished sessions from 2023; it is never estimated
 * from air temperature. Weather is described in words, not icons.
 */

const KINDS: ReadonlySet<string> = new Set(['FP1', 'FP2', 'FP3', 'Q', 'R', 'S', 'SQ']);

export interface ConditionsProps {
  lat: number;
  lon: number;
  raceStartIso: string;
  sessions: Array<{ kind: string; iso: string }>;
  season: number;
  now: number;
}

function Shell({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <SectionHead id="conditions-title" label="Weather at the circuit" title="Conditions" aside={note} />
      <div className="mt-10 md:mt-12">{children}</div>
    </div>
  );
}

function Pending({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-[60ch] rounded-[18px] p-6 ring-1 ring-[color:var(--bc-rule)] md:p-8">
      <p className="bc-wide text-[1.1rem]">{title}</p>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-[color:var(--bc-silver)]">{children}</p>
    </div>
  );
}

const TILE = 'min-w-0 bg-[color:var(--bc-night)] p-6 md:p-7';
const KEY = 'bc-label text-[color:var(--bc-titanium)]';

export async function Conditions(props: ConditionsProps) {
  const sessions = props.sessions.filter((s) => KINDS.has(s.kind) && s.iso).map((s) => ({ kind: s.kind as SessionKind, iso: s.iso }));
  const { start, end } = raceWeatherDateBounds(sessions, props.raceStartIso);
  const [raw, track] = await Promise.all([
    openmeteo.getRaceWeather({ lat: props.lat, lon: props.lon, dateStart: start, dateEnd: end, revalidate: 3600, now: props.now }),
    loadMeasuredTrackTemperatures({ season: props.season, sessions, now: props.now }),
  ]);

  const unavailable = (
    <Shell>
      <Pending title="Weather unavailable">
        {Date.parse(props.raceStartIso) < props.now && pickWeatherSource(Date.parse(`${start}T00:00:00Z`), Date.parse(`${end}T00:00:00Z`), props.now) === 'none'
          ? 'Weather is shown for races from the last five years. This race is older.'
          : Date.parse(props.raceStartIso) < props.now
          ? 'Weather for this weekend can’t be shown right now. Please check back in a few minutes.'
          : Date.parse(props.raceStartIso) - props.now > 16 * 86_400_000
            ? 'The forecast appears here about two weeks before the race weekend.'
            : 'The forecast can’t be shown right now. Please check back in a few minutes.'}
      </Pending>
    </Shell>
  );
  if (!raw) return unavailable;
  const ui = mapRaceWeather({ weather: raw, sessions, raceStartIso: props.raceStartIso });
  if (!ui.raceDay && ui.sessions.every((s) => s.peakAirTempC == null)) return unavailable;

  const recorded = ui.source === 'archive';
  const measured = new Map<string, MeasuredTrackTemp>(track.state === 'measured' ? track.sessions.map((s) => [s.kind + s.iso, s]) : []);
  const lo = ui.raceDay?.minAirTempC;
  const hi = ui.raceDay?.maxAirTempC;
  const rain = ui.raceDay?.totalPrecipitationMm ?? null;
  const view = conditionsView(ui, recorded, props.now);
  // A live weekend reads the forecast feed, which also carries the model's analysis of hours already past.
  const someRun = !recorded && ui.sessions.some((s) => statedAsFact(s, false, props.now));
  const trackNote =
    track.state === 'measured' ? 'Track temperature is measured at the circuit during each finished session.'
      : track.state === 'pending' ? 'Track temperature is shown after each session.'
        : track.state === 'not-covered' ? 'Measured track temperatures are available from the 2023 season onwards.'
          : 'Measured track temperatures can’t be shown right now. Please check back later.';

  return (
    <Shell note={<span className="bc-label rounded-full px-3 py-1.5 text-[0.66rem] text-[color:var(--bc-silver)] ring-1 ring-white/15">{recorded ? 'Recorded weather' : someRun ? 'Recorded and forecast' : 'Forecast'}</span>}>
      <div className="relative overflow-hidden rounded-[22px] ring-1 ring-[color:var(--bc-rule)]">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-[12%] h-56 w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.09),transparent)]" />
        <div className="relative grid gap-px bg-[color:var(--bc-rule)] lg:grid-cols-12">
          <div className={`${TILE} lg:col-span-5`}>
            <p className={KEY}>{view.basis}</p>
            <p className="bc-display mt-4 text-[clamp(1.8rem,3.4vw,2.8rem)]">{view.headline}</p>
            {view.raceRain && <p className="mt-3 text-[1rem] text-white">{view.raceRain}</p>}
            {view.summary && <p className="mt-3 max-w-[48ch] text-[0.92rem] leading-relaxed text-[color:var(--bc-silver)]">{view.summary}</p>}
            {view.wetSessions.length > 0 && (
              <div className="mt-5 border-t border-[color:var(--bc-rule)] pt-4">
                <p className={KEY}>{recorded || someRun ? 'Rain in other sessions' : 'Rain likely in other sessions'}</p>
                <ul className="mt-2 space-y-1">
                  {view.wetSessions.map((w) => <li key={w} className="text-[0.9rem] text-[color:var(--bc-silver)]">{w}</li>)}
                </ul>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-px bg-[color:var(--bc-rule)] sm:grid-cols-3 lg:col-span-7">
            {/* Phones: the air range gets the full row so "27–32 °C" never splits; rain and wind share the next. */}
            <div className={`${TILE} col-span-2 sm:col-span-1`}>
              <dt className={KEY}>Air, race day</dt>
              <dd className="bc-mono mt-3 whitespace-nowrap text-[clamp(2rem,3.6vw,2.9rem)] leading-none text-white">
                {lo != null && hi != null ? `${Math.round(lo)}–${Math.round(hi)}` : hi != null ? Math.round(hi) : '–'}
                <span className="ml-1.5 font-text text-[0.85rem] text-[color:var(--bc-titanium)]">°C</span>
              </dd>
            </div>
            <div className={TILE}>
              <dt className={KEY}>Rain, race day</dt>
              <dd className="bc-mono mt-3 text-[clamp(2rem,3.6vw,2.9rem)] leading-none text-white">
                {rain != null ? rain.toFixed(1) : '–'}<span className="ml-1.5 font-text text-[0.85rem] text-[color:var(--bc-titanium)]">mm</span>
              </dd>
              {view.raceDayFlag && <dd className="mt-2 text-[0.85rem] text-[color:var(--bc-red-text)]">{view.raceDayFlag}</dd>}
            </div>
            <div className={TILE}>
              <dt className={KEY}>Peak wind, race day</dt>
              <dd className="bc-mono mt-3 text-[clamp(2rem,3.6vw,2.9rem)] leading-none text-white">
                {ui.raceDay?.peakWindKph ?? '–'}<span className="ml-1.5 font-text text-[0.85rem] text-[color:var(--bc-titanium)]">km/h</span>
              </dd>
              {ui.raceDay?.peakWindKph != null && ui.raceDay.peakWindKph > 30 && <dd className="mt-2 text-[0.85rem] text-[color:var(--bc-red-text)]">{recorded ? 'Strong wind that day' : 'Strong wind possible'}</dd>}
            </div>
          </dl>
        </div>

        {ui.sessions.length > 0 && (
          <ul aria-label="Weather by session" className="relative grid gap-px border-t border-[color:var(--bc-rule)] bg-[color:var(--bc-rule)] sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
            {ui.sessions.map((s) => {
              const t = measured.get(s.kind + s.iso);
              const sky = bucketFromWeathercode(s.weathercode);
              const fact = statedAsFact(s, recorded, props.now);
              const rainClause = sessionRainClause(s, fact);
              return (
                <li key={s.kind + s.iso} className="flex flex-col gap-2 bg-[color:var(--bc-carbon)] p-5">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="bc-wide text-[0.95rem]">{sessionName(s.kind)}</span>
                    <ClockTime iso={s.iso} parts="day" className="text-[0.8rem] text-[color:var(--bc-titanium)]" />
                  </span>
                  <span className="bc-mono text-[1.6rem] leading-none text-white">{s.peakAirTempC != null ? `${Math.round(s.peakAirTempC)}°` : '–'}</span>
                  <span className="text-[0.88rem] text-[color:var(--bc-silver)]">
                    {sky === 'unknown' ? 'Sky not reported' : bucketLabel(sky)}
                    {rainClause ? ` · ${rainClause}` : ''}
                  </span>
                  <span className="text-[0.88rem] text-[color:var(--bc-silver)]">
                    {s.peakWindKph != null ? `Wind ${s.peakWindKph} km/h` : 'Wind not reported'}
                    {s.windDirectionDeg != null ? ` from ${cardinalFromDeg(s.windDirectionDeg)}` : ''}
                  </span>
                  {t && <span className="text-[0.88rem] text-white">Track {t.minC === t.maxC ? t.maxC : `${t.minC}–${t.maxC}`} °C <span className="text-[color:var(--bc-titanium)]">measured</span></span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="mt-5 text-[0.875rem] leading-relaxed text-[color:var(--bc-titanium)]">{recorded ? 'Air, rain and wind: the recorded values nearest the circuit.' : someRun ? 'Air, rain and wind: sessions that have run show the weather for those hours; the rest is a forecast and may change as the weekend nears.' : 'Air, rain and wind are a forecast and may change as the weekend nears.'} {trackNote}</p>
    </Shell>
  );
}
