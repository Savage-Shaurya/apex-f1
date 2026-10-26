import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openmeteo, pickWeatherSource } from './client';
import { headlineCondition, mapRaceWeather } from './mappers';
import type { RaceWeather } from './types';

function singaporeForecast(): RaceWeather {
  return {
    source: 'forecast', latitude: 1.3, longitude: 103.8, timezone: 'Asia/Singapore',
    hourly: {
      time: ['2026-09-30T12:00', '2026-09-30T20:00', '2026-09-30T21:00'],
      temperature_2m: [20, 30, 31], precipitation: [0, 0, 0],
      precipitation_probability: [0, 0, 0], wind_speed_10m: [10, 10, 10],
      wind_direction_10m: [180, 350, 10], weathercode: [0, 0, 0],
    },
    daily: {
      time: ['2026-09-30'], temperature_2m_max: [31], temperature_2m_min: [20],
      precipitation_sum: [0], precipitation_probability_max: [0],
      wind_speed_10m_max: [10], weathercode: [0],
    },
  };
}

const race = (weather: RaceWeather) => mapRaceWeather({
  weather, sessions: [{ kind: 'R', iso: '2026-09-30T12:00:00Z' }],
  raceStartIso: '2026-09-30T12:00:00Z',
});

test('Singapore race selects its evening forecast using the UTC session start', () => {
  const result = race(singaporeForecast());
  assert.equal(result.sessions[0]?.peakAirTempC, 31);
  assert.equal(result.raceDay?.date, '2026-09-30');
});

test('a date-only session never receives an invented midnight forecast', () => {
  const weather = singaporeForecast();
  weather.timezone = 'GMT';
  weather.hourly.time = ['2026-09-30T00:00Z', '2026-09-30T01:00Z', '2026-09-30T02:00Z'];
  for (const date of ['2026-09-30', '2026-09-30Z']) {
    const result = mapRaceWeather({ weather, sessions: [{ kind: 'R', iso: date }], raceStartIso: date });
    assert.equal(result.sessions[0]?.peakAirTempC, null);
    assert.equal(result.sessions[0]?.precipitationMm, null);
    assert.equal(result.sessions[0]?.windDirectionDeg, null);
    assert.equal(result.sessions[0]?.weathercode, null);
    assert.equal(result.summary, 'Conditions unavailable');
  }
});

test('a missing rain observation remains unknown through totals and risk labels', () => {
  const weather = singaporeForecast();
  weather.hourly.precipitation = [0, null, 0];
  weather.daily.precipitation_sum = [null];
  const result = race(weather);
  assert.equal(result.sessions[0]?.precipitationMm, null);
  assert.equal(result.raceDay?.totalPrecipitationMm, null);
  assert.equal(result.risks.heavyRain, null);
  assert.equal(result.availability, 'partial');
  assert.equal(result.summary.includes('Dry'), false);
});

test('wind around north averages to north while opposing winds stay unknown', () => {
  const weather = singaporeForecast();
  assert.equal(race(weather).sessions[0]?.windDirectionDeg, 0);
  weather.hourly.wind_direction_10m = [180, 90, 270];
  assert.equal(race(weather).sessions[0]?.windDirectionDeg, null);
});

test('forecast requests local days (timezone=auto) and accepts a legacy GMT string axis', async () => {
  const date = new Date().toISOString().slice(0, 10);
  let requests = 0;
  const fetchImpl: typeof fetch = async (input) => {
    requests += 1;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('timezone'), 'auto');
    return new Response(JSON.stringify({
      utc_offset_seconds: 0,
      hourly: { time: [`${date}T12:00`], temperature_2m: [null], precipitation: [null] },
      daily: { time: [date], precipitation_sum: [null] },
    }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await openmeteo.getRaceWeather({ lat: 1.3, lon: 103.8, dateStart: date, dateEnd: date, fetchImpl });
  assert.equal(requests, 1);
  assert.equal(result?.hourly.time[0], `${date}T12:00Z`);
  assert.equal(result?.hourly.precipitation[0], null);
  assert.equal(result?.daily.precipitation_sum[0], null);
});

// ── Source selection around a race weekend (COTA 2026: 23–25 October) ──────

const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

test('race day, the day after and two weeks ahead all read the forecast API', () => {
  const start = utc('2026-10-23');
  const end = utc('2026-10-25');
  // Race day: the weekend started two days ago and ends today.
  assert.equal(pickWeatherSource(start, end, Date.parse('2026-10-25T21:30:00Z')), 'forecast');
  // Second day of the weekend.
  assert.equal(pickWeatherSource(start, end, Date.parse('2026-10-24T09:00:00Z')), 'forecast');
  // The day after: forecast still serves yesterday's hours.
  assert.equal(pickWeatherSource(start, end, Date.parse('2026-10-26T06:00:00Z')), 'forecast');
  // Two days after: the archive has the weekend.
  assert.equal(pickWeatherSource(start, end, Date.parse('2026-10-27T06:00:00Z')), 'archive');
  // Two weeks ahead (race day 14 days away).
  assert.equal(pickWeatherSource(utc('2026-11-06'), utc('2026-11-08'), Date.parse('2026-10-25T12:00:00Z')), 'forecast');
  // Beyond the 15-day forecast horizon.
  assert.equal(pickWeatherSource(utc('2026-11-20'), utc('2026-11-22'), Date.parse('2026-10-25T12:00:00Z')), 'none');
  // Older than the five-year archive window.
  assert.equal(pickWeatherSource(utc('2019-11-01'), utc('2019-11-03'), Date.parse('2026-10-25T12:00:00Z')), 'none');
});

test('race-day request goes to the forecast endpoint with the injected clock', async () => {
  const hosts: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    hosts.push(new URL(String(input)).hostname);
    return new Response(JSON.stringify({ utc_offset_seconds: 0, hourly: { time: [] }, daily: { time: [] } }), { headers: { 'content-type': 'application/json' } });
  };
  const result = await openmeteo.getRaceWeather({
    lat: 30.1328, lon: -97.6411, dateStart: '2026-10-23', dateEnd: '2026-10-25', fetchImpl,
    now: Date.parse('2026-10-25T20:00:00Z'),
  });
  assert.equal(result?.source, 'forecast');
  assert.deepEqual(hosts, ['api.open-meteo.com']);
});

test('the mapper never derives a track temperature from air temperature', () => {
  const result = race(singaporeForecast());
  assert.equal('peakTrackTempC' in result.sessions[0]!, false);
  assert.equal(JSON.stringify(result).toLowerCase().includes('track'), false);
});

test('heading and summary share one condition from the race session window', () => {
  const weather = singaporeForecast();
  // The race window is clear while the day's most severe code is rain.
  weather.daily.weathercode = [61];
  weather.daily.precipitation_sum = [0.2];
  const result = race(weather);
  assert.equal(result.condition.label, 'Clear');
  assert.equal(result.condition.basis, 'race-session');
  assert.equal(result.summary.startsWith(result.condition.label), true);
});

test('storm risk overrides a clear sky in both heading and summary', () => {
  const condition = headlineCondition(null, [{
    kind: 'R', iso: '2026-09-30T12:00:00Z', peakAirTempC: 30, precipitationProbabilityPct: null,
    precipitationMm: 0, peakWindKph: 10, windDirectionDeg: 0, weathercode: 0,
  }], { heavyRain: false, extremeHeat: false, highWind: false, thunderstorm: true });
  assert.deepEqual(condition, { bucket: 'thunderstorm', label: 'Thunderstorm risk', basis: 'race-session' });
});

test('without a session window the race-day code is the labelled basis', () => {
  const condition = headlineCondition({ date: '2026-09-30', maxAirTempC: 30, minAirTempC: 20, totalPrecipitationMm: 0, peakWindKph: 10, weathercode: 3 },
    [], { heavyRain: false, extremeHeat: false, highWind: false, thunderstorm: false });
  assert.deepEqual(condition, { bucket: 'overcast', label: 'Overcast', basis: 'race-day' });
});

test('D2-DATA-TRUTH-4: race-day totals use the circuit\'s local day (Sepang, unixtime axis)', async () => {
  // Kuala Lumpur is GMT+8: local 2017-10-01 starts at 2017-09-30T16:00Z.
  const localMidnight = Date.parse('2017-09-30T16:00:00Z') / 1000;
  let requested = null as URL | null;
  const fetchImpl: typeof fetch = async (input) => {
    requested = new URL(String(input));
    return Response.json({
      utc_offset_seconds: 28_800, timezone: 'Asia/Kuala_Lumpur',
      hourly: { time: [localMidnight + 15 * 3600, localMidnight + 16 * 3600], temperature_2m: [31.5, 31.9], precipitation: [0, 0.4], wind_speed_10m: [5, 6], wind_direction_10m: [90, 90], weathercode: [2, 61] },
      daily: { time: [localMidnight - 86_400, localMidnight], temperature_2m_max: [31.0, 31.9], temperature_2m_min: [23.8, 24.2], precipitation_sum: [8.0, 6.5], wind_speed_10m_max: [10, 12], weathercode: [61, 61] },
    });
  };
  const weather = await openmeteo.getRaceWeather({ lat: 2.76, lon: 101.73, dateStart: '2017-09-29', dateEnd: '2017-10-01', fetchImpl, now: Date.parse('2018-01-15T00:00:00Z') });
  assert.ok(requested);
  assert.equal(requested!.searchParams.get('timeformat'), 'unixtime');
  assert.equal(requested!.searchParams.get('start_date'), '2017-09-28');
  assert.equal(requested!.searchParams.get('end_date'), '2017-10-02');
  assert.deepEqual(weather?.daily.time, ['2017-09-30', '2017-10-01']);
  assert.equal(weather?.hourly.time[0], '2017-10-01T07:00Z');
  const ui = mapRaceWeather({ weather: weather!, sessions: [{ kind: 'R', iso: '2017-10-01T07:00:00Z' }], raceStartIso: '2017-10-01T07:00:00Z' });
  assert.equal(ui.raceDay?.date, '2017-10-01');
  assert.equal(ui.raceDay?.minAirTempC, 24.2);
  assert.equal(ui.raceDay?.totalPrecipitationMm, 6.5);
});

test('D2-DATA-TRUTH-3: finished races use past-tense labels; the heading comes from the race session only', () => {
  const risks = { heavyRain: true, extremeHeat: false, highWind: false, thunderstorm: false };
  assert.equal(headlineCondition(null, [], risks, 'observed').label, 'Heavy rain');
  assert.equal(headlineCondition(null, [], risks).label, 'Heavy rain risk');
  assert.equal(headlineCondition(null, [], { ...risks, thunderstorm: true }, 'observed').label, 'Thunderstorms');
  // A qualifying-only window never sets the race heading.
  const quali = headlineCondition(null, [{ kind: 'Q', iso: '2026-09-30T12:00:00Z', peakAirTempC: 30, precipitationProbabilityPct: null, precipitationMm: 0, peakWindKph: 10, windDirectionDeg: 0, weathercode: 61 }], { heavyRain: false, extremeHeat: false, highWind: false, thunderstorm: false });
  assert.equal(quali.basis, 'none');
});
