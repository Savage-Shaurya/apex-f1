import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openf1, type FetchOpts } from './index';
import { ProviderError } from '../transport';

const date = '2026-10-04T12:00:00Z';
const session = { session_key: 42, meeting_key: 7, session_name: 'Race', session_type: 'Race', date_start: date, date_end: '2026-10-04T14:00:00Z', circuit_key: 2, circuit_short_name: 'Silverstone', country_code: 'GBR', country_name: 'United Kingdom', location: 'Silverstone', gmt_offset: '00:00:00', year: 2026 };
const opts = (rows: unknown[]): FetchOpts => ({ strict: true, fetchImpl: async () => Response.json(rows) });

test('numeric session requests reject foreign records for every session-scoped OpenF1 endpoint', async () => {
  const methods: Array<[string, (options: FetchOpts) => Promise<unknown>, Record<string, unknown>]> = [
    ['session', (options) => openf1.getSession(42, options), session],
    ['drivers', (options) => openf1.getDrivers(42, options), { session_key: 42, driver_number: 4, full_name: 'Local Driver', name_acronym: 'LOC' }],
    ['intervals', (options) => openf1.getIntervals(42, options), { session_key: 42, driver_number: 4, date, interval: 1 }],
    ['positions', (options) => openf1.getPositions(42, options), { session_key: 42, driver_number: 4, date, position: 1 }],
    ['laps', (options) => openf1.getLaps(42, options), { session_key: 42, driver_number: 4, lap_number: 1 }],
    ['stints', (options) => openf1.getStints(42, options), { session_key: 42, driver_number: 4, stint_number: 1, compound: 'SOFT' }],
    ['race control', (options) => openf1.getRaceControl(42, options), { session_key: 42, date, category: 'Flag', message: 'GREEN' }],
    ['weather', (options) => openf1.getWeather(42, options), { session_key: 42, date, air_temperature: 24 }],
    ['pits', (options) => openf1.getPits(42, options), { session_key: 42, driver_number: 4, lap_number: 1, date }],
  ];
  for (const [name, call, row] of methods) {
    assert.ok(await call(opts([row])), name);
    await assert.rejects(call(opts([{ ...row, session_key: 99 }])), (error: ProviderError) => error.code === 'invalid-response', name);
    await assert.rejects(call(opts([row, { ...row, session_key: 99 }])), (error: ProviderError) => error.code === 'invalid-response', `${name} mixed response`);
    const fallback = await call({ ...opts([{ ...row, session_key: 99 }]), strict: false });
    assert.deepEqual(fallback, name === 'session' ? null : [], name);
  }
});

test('meeting-scoped session requests require the requested meeting, while latest lookup accepts real identity', async () => {
  assert.equal((await openf1.getSessionsForMeeting(7, opts([session])))[0]!.meeting_key, 7);
  await assert.rejects(openf1.getSessionsForMeeting(7, opts([{ ...session, meeting_key: 8 }])), (error: ProviderError) => error.code === 'invalid-response');
  assert.equal((await openf1.getLatestSession(opts([{ ...session, session_key: 99 }])))!.session_key, 99);
  assert.equal((await openf1.getSession('latest', opts([{ ...session, session_key: 100 }])))!.session_key, 100);
});

test('bounded GPS queries validate both session and requested driver identity', async () => {
  const row = { session_key: 42, driver_number: 4, date: '2026-10-04T12:00:30Z', x: 1, y: 2, z: 3 };
  const options = { ...opts([row]), driverNumber: 4, dateGte: date, dateLte: '2026-10-04T12:01:00Z' };
  assert.equal((await openf1.getLocation(42, options))[0]!.driver_number, 4);
  await assert.rejects(openf1.getLocation(42, { ...options, ...opts([{ ...row, driver_number: 16 }]) }), (error: ProviderError) => error.code === 'invalid-response');
  await assert.rejects(openf1.getLocation(42, { ...options, ...opts([{ ...row, session_key: 99 }]) }), (error: ProviderError) => error.code === 'invalid-response');
  assert.equal((await openf1.getLocation(42, { ...options, driverNumber: undefined, ...opts([{ ...row, driver_number: 16 }]) }))[0]!.driver_number, 16);
});

test('driver acronym and temporal bounds reject foreign rows without relabelling them', async () => {
  const driver = { session_key: 42, driver_number: 4, full_name: 'Local Driver', name_acronym: 'LOC' };
  assert.equal((await openf1.getDriversByAcronym('LOC', opts([driver])))[0]!.name_acronym, 'LOC');
  await assert.rejects(openf1.getDriversByAcronym('LOC', opts([{ ...driver, name_acronym: 'OTHER' }])), (error: ProviderError) => error.code === 'invalid-response');
  await assert.rejects(openf1.getDriversByAcronym('private/url', opts([driver])), (error: ProviderError) => error.code === 'invalid-input');
  const options = { dateGte: date, dateLte: '2026-10-04T12:01:00Z' };
  for (const value of [date, '2026-10-04T11:59:00Z', options.dateLte, '2026-10-04T12:01:01Z']) {
    await assert.rejects(openf1.getLocation(42, { ...options, ...opts([{ session_key: 42, driver_number: 4, date: value, x: 1, y: 2, z: 3 }]) }), (error: ProviderError) => error.code === 'invalid-response');
  }
});

test('session metadata and dates are complete and truthful before they reach public pages', async () => {
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['missing location', { location: undefined }], ['empty country', { country_name: ' ' }],
    ['missing circuit label', { circuit_short_name: undefined }], ['missing country code', { country_code: undefined }],
    ['missing timezone', { gmt_offset: undefined }], ['empty session name', { session_name: '' }],
    ['empty session type', { session_type: '' }], ['wrong year type', { year: '2026' }],
    ['fractional year', { year: 2026.5 }], ['missing meeting identity', { meeting_key: undefined }],
    ['missing circuit identity', { circuit_key: undefined }], ['invalid cancellation', { is_cancelled: 'false' }],
    ['reverse dates', { date_end: '2026-10-04T11:59:00Z' }], ['zero duration', { date_end: date }],
    ['unqualified timezone', { date_start: '2026-10-04T12:00:00' }],
    ['nonexistent date', { date_start: '2026-02-30T12:00:00Z' }],
  ];
  for (const [name, fields] of invalid) {
    await assert.rejects(openf1.getLatestSession(opts([{ ...session, ...fields }])), (error: ProviderError) => error.code === 'invalid-response', name);
    assert.equal(await openf1.getLatestSession({ ...opts([{ ...session, ...fields }]), strict: false }), null, name);
  }
  assert.deepEqual(await openf1.getLatestSession(opts([session])), session);
  assert.equal((await openf1.getLatestSession(opts([{ ...session, is_cancelled: true }])))!.is_cancelled, true);
  assert.equal((await openf1.getLatestSession(opts([{ ...session, date_start: '2026-10-04T13:00:00+01:00' }])))!.session_key, 42);
  assert.equal(await openf1.getLatestSession(opts([])), null);
});

test('optional stint lap and tyre age fields preserve unknown values and reject malformed numbers', async () => {
  const stint = { session_key: 42, driver_number: 4, stint_number: 1, compound: 'SOFT' };
  for (const key of ['lap_start', 'lap_end', 'tyre_age_at_start']) {
    for (const value of ['40', -1, 1.5, 'Infinity', 'NaN']) {
      await assert.rejects(openf1.getStints(42, opts([{ ...stint, [key]: value }])), (error: ProviderError) => error.code === 'invalid-response', `${key}: ${String(value)}`);
    }
    await assert.rejects(openf1.getStints(42, { strict: true, fetchImpl: async () => new Response(`[${JSON.stringify(stint).slice(0, -1)},"${key}":1e999}]`) }), (error: ProviderError) => error.code === 'invalid-response', `${key}: non-finite JSON exponent`);
    assert.deepEqual((await openf1.getStints(42, opts([{ ...stint, [key]: null }])))[0], { ...stint, [key]: null });
    assert.equal((await openf1.getStints(42, opts([{ ...stint, [key]: 0 }])))[0]![key as 'lap_end'], 0);
  }
  assert.deepEqual((await openf1.getStints(42, opts([stint])))[0], stint);
});

test('session results validate identity, positions and status flags', async () => {
  const row = { session_key: 42, meeting_key: 7, driver_number: 12, position: 1, number_of_laps: 18, dnf: false, dns: false, dsq: false, duration: [95.39, 94.278, 94.035], gap_to_leader: [0.361, 0.08, 0] };
  const rows = await openf1.getSessionResult(42, opts([row, { ...row, driver_number: 3, position: null, dns: true }]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.position, 1);
  await assert.rejects(openf1.getSessionResult(42, opts([{ ...row, session_key: 99 }])), (error: ProviderError) => error.code === 'invalid-response');
  await assert.rejects(openf1.getSessionResult(42, opts([{ ...row, position: 0 }])), (error: ProviderError) => error.code === 'invalid-response');
  await assert.rejects(openf1.getSessionResult(42, opts([{ ...row, dnf: 'yes' }])), (error: ProviderError) => error.code === 'invalid-response');
});
