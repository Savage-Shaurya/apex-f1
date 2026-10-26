import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenF1LiveSessionLockout, type OpenF1Session, type OpenF1Weather } from '@apex/api-client/openf1';
import { loadMeasuredTrackTemperatures, loadWeekendSessionTimes, reconcileWeekendSessions, summariseTrackTemperatures, type TrackTemperatureProvider } from './track-temperature';

// Shapes follow OpenF1 /sessions and /weather for the 2026 United States GP (meeting 1297).
const session = (key: number, name: string, start: string, end: string): OpenF1Session => ({
  session_key: key, session_type: name === 'Race' ? 'Race' : 'Practice', session_name: name,
  date_start: start, date_end: end, meeting_key: 1297, circuit_key: 9, circuit_short_name: 'Austin',
  country_code: 'USA', country_name: 'United States', location: 'Austin', gmt_offset: '-05:00:00', year: 2026,
});
const SESSIONS = [
  session(11389, 'Practice 1', '2026-10-23T17:30:00+00:00', '2026-10-23T18:30:00+00:00'),
  session(11392, 'Qualifying', '2026-10-24T21:00:00+00:00', '2026-10-24T22:00:00+00:00'),
  session(11393, 'Race', '2026-10-25T20:00:00+00:00', '2026-10-25T22:00:00+00:00'),
];
const sample = (key: number, date: string, track: number): OpenF1Weather => ({ session_key: key, meeting_key: 1297, date, track_temperature: track, air_temperature: 27 });
const WEATHER = [
  sample(11389, '2026-10-23T17:17:00+00:00', 30.0), // before the session: ignored
  sample(11389, '2026-10-23T17:40:00+00:00', 39.1),
  sample(11389, '2026-10-23T18:23:00+00:00', 0.0), // sensor drop-out: ignored
  sample(11389, '2026-10-23T18:25:00+00:00', 43.2),
  sample(11392, '2026-10-24T21:10:00+00:00', 40.7),
  sample(11392, '2026-10-24T21:50:00+00:00', 36.5),
];
const JOLPICA = [
  { kind: 'FP1', iso: '2026-10-23T17:30:00Z' },
  { kind: 'Q', iso: '2026-10-24T21:00:00Z' },
  { kind: 'R', iso: '2026-10-25T20:00:00Z' },
];
const RACE_MORNING = Date.parse('2026-10-25T12:00:00Z');

test('finished sessions report measured min and max inside their own window', () => {
  assert.deepEqual(summariseTrackTemperatures(JOLPICA, SESSIONS, WEATHER, RACE_MORNING), [
    { kind: 'FP1', iso: '2026-10-23T17:30:00Z', minC: 39, maxC: 43, samples: 2 },
    { kind: 'Q', iso: '2026-10-24T21:00:00Z', minC: 37, maxC: 41, samples: 2 },
  ]);
});

const provider = (calls: string[], overrides: Partial<TrackTemperatureProvider> = {}): TrackTemperatureProvider => ({
  getSessionsForYear: async (year) => { calls.push(`sessions:${year}`); return SESSIONS; },
  getWeatherForMeeting: async (key) => { calls.push(`weather:${key}`); return WEATHER; },
  ...overrides,
});

test('loader states: pending before any session, not covered before 2023, measured after', async () => {
  const calls: string[] = [];
  assert.deepEqual(await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: Date.parse('2026-10-20T00:00:00Z'), provider: provider(calls) }), { state: 'pending' });
  assert.deepEqual(await loadMeasuredTrackTemperatures({ season: 2019, sessions: JOLPICA, now: RACE_MORNING, provider: provider(calls) }), { state: 'not-covered' });
  assert.deepEqual(calls, []);
  const measured = await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: RACE_MORNING, provider: provider(calls) });
  assert.equal(measured.state, 'measured');
  assert.deepEqual(calls, ['sessions:2026', 'weather:1297']);
});

test('a provider failure is unavailable, never an estimate', async () => {
  const failing = provider([], { getWeatherForMeeting: async () => { throw new Error('openf1: http (HTTP 401)'); } });
  assert.deepEqual(await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: RACE_MORNING, provider: failing }), { state: 'unavailable' });
  const empty = provider([], { getWeatherForMeeting: async () => [] });
  assert.deepEqual(await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: RACE_MORNING, provider: empty }), { state: 'unavailable' });
});

// 2026 Miami GP (meeting 1284): Jolpica schedules the race at 20:00Z, the timing feed shows it ran 17:00-19:00Z.
const miami = (key: number, name: string, start: string, end: string): OpenF1Session => ({
  ...session(key, name, start, end), meeting_key: 1284, circuit_key: 151, circuit_short_name: 'Miami', location: 'Miami Gardens', gmt_offset: '-04:00:00',
});
const MIAMI = [
  miami(11270, 'Practice 1', '2026-05-01T16:00:00+00:00', '2026-05-01T17:30:00+00:00'),
  miami(11271, 'Sprint Qualifying', '2026-05-01T20:30:00+00:00', '2026-05-01T21:14:00+00:00'),
  miami(11275, 'Sprint', '2026-05-02T16:00:00+00:00', '2026-05-02T17:00:00+00:00'),
  miami(11276, 'Qualifying', '2026-05-02T20:00:00+00:00', '2026-05-02T21:00:00+00:00'),
  miami(11280, 'Race', '2026-05-03T17:00:00+00:00', '2026-05-03T19:00:00+00:00'),
  ...SESSIONS,
];
const MIAMI_JOLPICA = [
  { kind: 'FP1', iso: '2026-05-01T16:00:00Z' },
  { kind: 'SQ', iso: '2026-05-01T20:30:00Z' },
  { kind: 'S', iso: '2026-05-02T16:00:00Z' },
  { kind: 'Q', iso: '2026-05-02T20:00:00Z' },
  { kind: 'R', iso: '2026-05-03T20:00:00Z' },
];

test('D2-DATA-TRUTH-2: a race run at a different time from the schedule still finds its own timing session', async () => {
  const reconciled = reconcileWeekendSessions(MIAMI_JOLPICA, MIAMI);
  const race = reconciled.find((row) => row.kind === 'R')!;
  assert.equal(race.sessionKey, 11280);
  assert.equal(race.iso, '2026-05-03T17:00:00.000Z');
  assert.equal(race.rescheduled, true);
  assert.equal(reconciled.find((row) => row.kind === 'Q')!.rescheduled, false);
  const weather = [sample(11280, '2026-05-03T17:30:00+00:00', 48.4), sample(11280, '2026-05-03T18:40:00+00:00', 45.1)];
  const after = Date.parse('2026-05-04T00:00:00Z');
  const measured = await loadMeasuredTrackTemperatures({ season: 2026, sessions: MIAMI_JOLPICA, now: after, provider: { getSessionsForYear: async () => MIAMI, getWeatherForMeeting: async () => weather.map((row) => ({ ...row, meeting_key: 1284 })) } });
  assert.equal(measured.state, 'measured');
  assert.deepEqual(measured.state === 'measured' && measured.sessions.find((row) => row.kind === 'R'), { kind: 'R', iso: '2026-05-03T20:00:00Z', minC: 45, maxC: 48, samples: 2 });
  const times = await loadWeekendSessionTimes({ season: 2026, sessions: MIAMI_JOLPICA, provider: { getSessionsForYear: async () => MIAMI } });
  assert.equal(times.source, 'timing-feed');
  assert.equal(times.sessions.find((row) => row.kind === 'R')!.iso, '2026-05-03T17:00:00.000Z');
});

test('the lockout leaves an honest unavailable reason; stored data reports its age', async () => {
  const locked = new OpenF1LiveSessionLockout();
  const failing = provider([], { getSessionsForYear: async () => { throw locked; } });
  assert.deepEqual(await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: RACE_MORNING, provider: failing }), { state: 'unavailable', reason: 'live-session-lockout' });
  const storedAt = Date.parse('2026-10-24T22:30:00Z');
  const stored = provider([], {
    getSessionsForYear: async (_year, opts) => { opts?.onProvenance?.({ source: 'last-good', asOf: storedAt, reason: 'live-session-lockout' }); return SESSIONS; },
  });
  const state = await loadMeasuredTrackTemperatures({ season: 2026, sessions: JOLPICA, now: RACE_MORNING, provider: stored });
  assert.equal(state.state, 'measured');
  assert.equal(state.state === 'measured' && state.stale, true);
  assert.equal(state.state === 'measured' && state.asOf, storedAt);
});
