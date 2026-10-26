import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UiSessionWeather } from '@apex/api-client/openmeteo';
import { conditionsView, sessionHasRun, sessionRainClause, statedAsFact } from './conditions-view';

const session = (kind: UiSessionWeather['kind'], over: Partial<UiSessionWeather> = {}): UiSessionWeather => ({
  kind, iso: '2026-10-11T12:00:00Z', peakAirTempC: 30, precipitationProbabilityPct: null, precipitationMm: 0, peakWindKph: 10, windDirectionDeg: 180, weathercode: 3, ...over,
});

test('a wet sprint does not make a dry race read as rain (Singapore 2026, recorded)', () => {
  const v = conditionsView({
    sessions: [session('S', { precipitationMm: 2.4, weathercode: 61 }), session('R', { precipitationMm: 0, weathercode: 3 })],
    raceDay: { date: '2026-10-11', maxAirTempC: 32.2, minAirTempC: 26.8, totalPrecipitationMm: 3.4, peakWindKph: 11, weathercode: 61 },
  }, true);
  assert.equal(v.basis, 'During the race');
  assert.equal(v.headline, 'Overcast');
  assert.equal(v.raceRain, null);
  assert.deepEqual(v.wetSessions, ['Sprint: 2.4 mm']);
  // 3.4 mm is under the heavy-rain rule, so the race-day tile carries no flag.
  assert.equal(v.raceDayFlag, null);
  assert.equal(v.summary, 'Air 27–32 °C on race day · wind up to 11 km/h');
});

test('recorded race rain is stated as a fact for the race only', () => {
  const v = conditionsView({ sessions: [session('R', { precipitationMm: 6.1, weathercode: 63 })], raceDay: { date: 'x', maxAirTempC: null, minAirTempC: null, totalPrecipitationMm: 8, peakWindKph: null, weathercode: 63 } }, true);
  assert.equal(v.headline, 'Rain');
  assert.equal(v.raceRain, '6.1 mm of rain fell during the race');
  assert.equal(v.raceDayFlag, 'Heavy rain that day (over 5 mm)');
});

test('forecasts speak in chances and storms as a risk', () => {
  const v = conditionsView({ sessions: [session('Q', { precipitationProbabilityPct: 70 }), session('R', { precipitationProbabilityPct: 20, weathercode: 95 })], raceDay: null }, false);
  assert.equal(v.basis, 'Race forecast');
  assert.equal(v.headline, 'Thunderstorm risk');
  assert.equal(v.raceRain, null);
  assert.deepEqual(v.wetSessions, ['Qualifying: 70% chance of rain']);
  assert.equal(v.summary, 'Air 30 °C during the race · wind up to 10 km/h');
});

test('no sky code anywhere says so', () => {
  const v = conditionsView({ sessions: [session('R', { weathercode: null })], raceDay: null }, true);
  assert.equal(v.headline, 'Sky not reported');
  assert.equal(v.basis, 'Weekend');
});

test('during a live weekend, sessions that have run are stated as amounts, not chances (R18 2026)', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const fp1 = session('FP1', { iso: '2026-10-23T17:30:00Z', precipitationProbabilityPct: 0, precipitationMm: 0, weathercode: 0 });
  const q = session('Q', { iso: '2026-10-24T21:00:00Z', precipitationProbabilityPct: 60, precipitationMm: 1.2 });
  const r = session('R', { iso: '2026-10-25T20:00:00Z', precipitationProbabilityPct: 55, weathercode: 3 });
  assert.equal(statedAsFact(fp1, false, now), true);
  assert.equal(statedAsFact(r, false, now), false);
  assert.equal(sessionRainClause(fp1, true), 'no rain');
  assert.equal(sessionRainClause(r, false), '55% chance of rain');
  const v = conditionsView({ sessions: [fp1, q, r], raceDay: null }, false, now);
  assert.equal(v.basis, 'Race forecast');
  assert.deepEqual(v.wetSessions, ['Qualifying: 1.2 mm']);
  assert.equal(v.raceRain, '55% chance of rain during the race');
});

test('a session counts as run two hours after it starts; a date-only one the next day', () => {
  const start = '2026-10-25T20:00:00Z';
  assert.equal(sessionHasRun(start, Date.parse('2026-10-25T21:59:00Z')), false);
  assert.equal(sessionHasRun(start, Date.parse('2026-10-25T22:00:00Z')), true);
  assert.equal(sessionHasRun('1988-04-03', Date.parse('1988-04-03T23:00:00Z')), false);
  assert.equal(sessionHasRun('1988-04-03', Date.parse('1988-04-04T00:00:00Z')), true);
  assert.equal(sessionRainClause(session('R', { precipitationMm: null }), true), null);
});
