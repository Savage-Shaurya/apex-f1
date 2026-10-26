import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenF1Driver, OpenF1Session } from '@apex/api-client/openf1';
import { loadGridTiming, lookupGridTimingEntry, type GridTimingReader } from './grid-timing';

const instant = Date.parse('2026-10-04T15:00:00Z');
const session: OpenF1Session = {
  session_key: 12000, meeting_key: 1300, session_name: 'Race', session_type: 'Race',
  date_start: '2026-10-04T12:00:00Z', date_end: '2026-10-04T14:00:00Z', year: 2026,
  circuit_key: 2, circuit_short_name: 'Silverstone', country_name: 'United Kingdom', country_code: 'GBR',
  location: 'Silverstone', gmt_offset: '00:00:00',
};
const driver: OpenF1Driver = {
  session_key: 12000, driver_number: 1, full_name: 'Max Verstappen',
  name_acronym: 'VER', team_name: 'Red Bull Racing', team_colour: '3671C6',
  headshot_url: 'https://media.formula1.com/verified-session.png',
  country_code: 'NLD',
};

function fixture(options: { session?: OpenF1Session | null; drivers?: OpenF1Driver[]; acronymRows?: OpenF1Driver[]; sessionFailure?: boolean; rosterFailure?: boolean; acronymFailure?: boolean } = {}) {
  const calls: { method: string; identity?: number | string; strict?: boolean }[] = [];
  const reader: GridTimingReader = {
    observedAt: instant,
    getLatestSession: async opts => {
      calls.push({ method: 'session', strict: opts?.strict });
      if (options.sessionFailure) throw new Error('offline session failure');
      return options.session === undefined ? session : options.session;
    },
    getDrivers: async (key, opts) => {
      calls.push({ method: 'drivers', identity: key, strict: opts?.strict });
      if (options.rosterFailure) throw new Error('offline roster failure');
      return options.drivers ?? [driver];
    },
    getDriversByAcronym: async (acronym, opts) => {
      calls.push({ method: 'acronym', identity: acronym, strict: opts?.strict });
      if (options.acronymFailure) throw new Error('offline acronym failure');
      return options.acronymRows ?? [driver];
    },
  };
  return { reader, calls };
}

test('matching started session supplies only its own drivers through strict reads', async () => {
  const foreign = { ...driver, session_key: 11999, headshot_url: 'https://media.formula1.com/foreign.png' };
  const f = fixture({ drivers: [foreign, driver] });
  const timing = await loadGridTiming(f.reader, 2026);
  assert.deepEqual(timing, { sessionKey: 12000, drivers: [driver] });
  assert.deepEqual(f.calls, [{ method: 'session', strict: true }, { method: 'drivers', identity: 12000, strict: true }]);
});

test('a session from another year never supplies portraits or starts an acronym fallback', async () => {
  const f = fixture({ session: { ...session, year: 2025 } });
  const timing = await loadGridTiming(f.reader, 2026);
  assert.deepEqual(timing, { sessionKey: null, drivers: [] });
  assert.equal(await lookupGridTimingEntry(timing, 'VER', f.reader), null);
  assert.deepEqual(f.calls, [{ method: 'session', strict: true }]);
});

test('future and cancelled sessions never fetch a timing roster or acronym portrait', async () => {
  for (const invalidSession of [{ ...session, date_start: '2026-10-04T16:00:00Z', date_end: '2026-10-04T18:00:00Z' }, { ...session, is_cancelled: true }]) {
    const f = fixture({ session: invalidSession });
    const timing = await loadGridTiming(f.reader, 2026);
    assert.deepEqual(timing, { sessionKey: null, drivers: [] });
    assert.equal(await lookupGridTimingEntry(timing, 'VER', f.reader), null);
    assert.deepEqual(f.calls, [{ method: 'session', strict: true }]);
  }
});

test('historical acronym rows are admitted only for the verified session and requested driver', async () => {
  const foreign = { ...driver, session_key: 11000, headshot_url: 'https://media.formula1.com/old-season.png' };
  const otherDriver = { ...driver, name_acronym: 'HAM', driver_number: 44 };
  const f = fixture({ drivers: [], acronymRows: [driver, foreign, otherDriver] });
  const timing = await loadGridTiming(f.reader, 2026);
  assert.deepEqual(await lookupGridTimingEntry(timing, 'VER', f.reader), driver);
  assert.deepEqual(f.calls.at(-1), { method: 'acronym', identity: 'VER', strict: true });
  const foreignOnly = fixture({ drivers: [], acronymRows: [foreign, otherDriver] });
  assert.equal(await lookupGridTimingEntry(timing, 'VER', foreignOnly.reader), null);
});

test('unavailable season or session preserves photo fallback without further timing requests', async () => {
  for (const season of [null, NaN, 0, 2026.5]) {
    const f = fixture();
    assert.deepEqual(await loadGridTiming(f.reader, season), { sessionKey: null, drivers: [] });
    assert.deepEqual(f.calls, []);
  }
  for (const options of [{ session: null }, { sessionFailure: true }, { session: { ...session, date_start: 'invalid' } }]) {
    const f = fixture(options);
    const timing = await loadGridTiming(f.reader, 2026);
    assert.deepEqual(timing, { sessionKey: null, drivers: [] });
    assert.equal(await lookupGridTimingEntry(timing, 'VER', f.reader), null);
    assert.equal(f.calls.length, 1);
  }
});

test('roster failure retains verified session identity for bounded strict fallback, then fails truthfully', async () => {
  const f = fixture({ rosterFailure: true });
  const timing = await loadGridTiming(f.reader, 2026);
  assert.deepEqual(timing, { sessionKey: 12000, drivers: [] });
  assert.deepEqual(await lookupGridTimingEntry(timing, 'VER', f.reader), driver);
  const failed = fixture({ acronymFailure: true });
  assert.equal(await lookupGridTimingEntry(timing, 'VER', failed.reader), null);
});
