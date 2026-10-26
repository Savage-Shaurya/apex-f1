import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { ProviderError } from '../../../packages/api-client/src/transport';
import { createLiveSourceSnapshot, liveSourceFreshnessMs, liveSourceQuery, liveSourceRefreshAfterMs, liveSourceSnapshotRows, mergeLivePositionSnapshots, validateLiveSourceSnapshot, type LiveSourceAcquisition, type LiveSourceEndpoint, type LiveSourceIdentity } from './live-source-snapshot';

const NOW = Date.parse('2026-10-04T07:00:30Z');
const identity: LiveSourceIdentity = { endpoint: 'position', sessionKey: 42 };
const acquisition = (at = NOW): LiveSourceAcquisition => ({ acquisitionStartedAt: at - 100, acquisitionCompletedAt: at, coverageLower: new Date(at - 120_000).toISOString().slice(0, 19) + 'Z', coverageUpper: new Date(at).toISOString().slice(0, 19) + 'Z' });
const position = (driver = 1, at = NOW - 1000) => ({ session_key: 42, meeting_key: 9, driver_number: driver, date: new Date(at).toISOString(), position: driver });
const rejectsCode = (code: string) => (error: unknown) => error instanceof ProviderError && error.code === code;

test('stable source identities are separate from exact window queries and reject undeclared identities', () => {
  assert.equal(liveSourceQuery('position', 42), liveSourceQuery('position', 42));
  assert.notEqual(liveSourceQuery('position', 42), liveSourceQuery('intervals', 42));
  assert.notEqual(liveSourceQuery('position', 42), liveSourceQuery('position', 43));
  const oldExactQuery = createHash('sha256').update(JSON.stringify(['position', [['session_key', 42]], null, null])).digest('hex');
  assert.notEqual(liveSourceQuery('position', 42), oldExactQuery);
  for (const [endpoint, key] of [['sessions', 42], ['position', 'latest'], ['position', 0], ['__proto__', 42]] as const) assert.throws(() => liveSourceQuery(endpoint as LiveSourceEndpoint, key), rejectsCode('invalid-input'));
  for (const endpoint of ['sessions', 'drivers', 'position', 'intervals', 'stints', 'weather', 'race_control'] as LiveSourceEndpoint[]) assert.ok(liveSourceFreshnessMs(endpoint) <= 60_000);
  assert.equal(liveSourceRefreshAfterMs('stints'), 30_000);
});
test('raw source rows retain exact original dates while provider-only fields are removed after full strict validation', async () => {
  const row = { ...position(), date: '2026-10-04T12:30:28.123+05:30', opaque_secret: { token: 'discard-test-only' } };
  const snapshot = await createLiveSourceSnapshot(identity, [row], acquisition(), NOW);
  assert.equal((snapshot.rows[0] as typeof row).date, row.date);
  assert.equal(Object.hasOwn(snapshot.rows[0] as object, 'opaque_secret'), false);
  assert.deepEqual(await validateLiveSourceSnapshot(snapshot, identity, NOW), snapshot);
});
test('strict validation cannot hide a foreign or malformed older record behind a newer valid position', async () => {
  for (const row of [{ ...position(), session_key: 43 }, { ...position(), position: null }, { ...position(), driver_number: -1 }, { ...position(), date: 'not-a-date' }]) {
    await assert.rejects(createLiveSourceSnapshot(identity, [row, position()], acquisition(), NOW), rejectsCode('invalid-response'));
  }
});
test('source filter provenance uses actual UTC-second encoding and rejects strict boundary-equal records', async () => {
  const metadata = { ...acquisition(), coverageLower: '2026-10-04T12:28:30.123+05:30', coverageUpper: '2026-10-04T12:30:30.987+05:30' };
  const snapshot = await createLiveSourceSnapshot(identity, [position()], metadata, NOW);
  assert.equal(snapshot.coverageLower, '2026-10-04T06:58:30Z');
  assert.equal(snapshot.coverageUpper, '2026-10-04T07:00:30Z');
  for (const at of [Date.parse(snapshot.coverageLower!), Date.parse(snapshot.coverageUpper!)]) await assert.rejects(createLiveSourceSnapshot(identity, [position(1, at)], metadata, NOW), rejectsCode('invalid-response'));
  await assert.rejects(validateLiveSourceSnapshot({ ...snapshot, coverageUpper: metadata.coverageUpper }, identity, NOW), rejectsCode('invalid-response'));
});
test('source acquisition expiry is measured from physical start and is never renewed by completion time', async () => {
  const snapshot = await createLiveSourceSnapshot(identity, [position()], acquisition(), NOW);
  await validateLiveSourceSnapshot(snapshot, identity, snapshot.acquisitionStartedAt + 29_999);
  await assert.rejects(validateLiveSourceSnapshot(snapshot, identity, snapshot.acquisitionStartedAt + 30_000), rejectsCode('incomplete'));
  await assert.rejects(createLiveSourceSnapshot(identity, [position()], { ...acquisition(), acquisitionStartedAt: NOW - 30_000, acquisitionCompletedAt: NOW, coverageLower: null, coverageUpper: null }, NOW), rejectsCode('incomplete'));
});
test('future/reversed acquisition, invalid calendars, partial bounds, tampered identity and opaque envelopes fail', async () => {
  const snapshot = await createLiveSourceSnapshot(identity, [position()], acquisition(), NOW);
  const broken = [
    { ...snapshot, acquisitionStartedAt: NOW + 6000, acquisitionCompletedAt: NOW + 6001 },
    { ...snapshot, acquisitionCompletedAt: snapshot.acquisitionStartedAt - 1 },
    { ...snapshot, coverageLower: '2026-02-30T07:00:00Z' },
    { ...snapshot, coverageUpper: null },
    { ...snapshot, coverageUpper: snapshot.coverageLower },
    { ...snapshot, coverageUpper: new Date(NOW + 10_000).toISOString().slice(0, 19) + 'Z' },
    { ...snapshot, query: 'f'.repeat(64) }, { ...snapshot, sessionKey: 43 },
    { ...snapshot, token: 'discard-test-only' }, { ...snapshot, version: 2 },
    { ...snapshot, rows: [{ ...position(), opaque: 'extra-field' }] },
  ];
  for (const value of broken) await assert.rejects(validateLiveSourceSnapshot(value, identity, NOW), rejectsCode('invalid-response'));
});
test('future raw telemetry and invalid response sizes cannot become durable source snapshots', async () => {
  await assert.rejects(createLiveSourceSnapshot(identity, [position(1, NOW + 6000)], { ...acquisition(), coverageLower: null, coverageUpper: null }, NOW), rejectsCode('invalid-response'));
  await assert.rejects(createLiveSourceSnapshot(identity, [{ ...position(), date: '2026-02-30T07:00:00Z' }], { ...acquisition(), coverageLower: null, coverageUpper: null }, NOW), rejectsCode('invalid-response'));
  await assert.rejects(createLiveSourceSnapshot({ endpoint: 'intervals', sessionKey: 42 }, Array.from({ length: 10001 }, () => ({ ...position(), gap_to_leader: 0 })), acquisition(), NOW), rejectsCode('invalid-response'));
  await assert.rejects(createLiveSourceSnapshot(identity, [{ ...position(), extra: 'x'.repeat(8_000_001) }], acquisition(), NOW));
  await assert.rejects(createLiveSourceSnapshot(identity, [{ ...position(), meeting_key: ['nested'] }], acquisition(), NOW), rejectsCode('invalid-response'));
});
test('confirmed absence, future and cancelled sessions are retained as actual strict provider results', async () => {
  const sessionIdentity: LiveSourceIdentity = { endpoint: 'sessions', sessionKey: 'latest' };
  const metadata = { ...acquisition(), coverageLower: null, coverageUpper: null };
  assert.deepEqual((await createLiveSourceSnapshot(sessionIdentity, [], metadata, NOW)).rows, []);
  const session = { session_key: 42, meeting_key: 9, circuit_key: 7, year: 2026, session_type: 'Race', session_name: 'Race', location: 'Test', country_name: 'Test', country_code: 'TST', circuit_short_name: 'Test', gmt_offset: '+00:00', date_start: new Date(NOW + 60_000).toISOString(), date_end: new Date(NOW + 120_000).toISOString(), is_cancelled: true };
  assert.deepEqual((await createLiveSourceSnapshot(sessionIdentity, [session], metadata, NOW)).rows, [session]);
  await assert.rejects(createLiveSourceSnapshot(sessionIdentity, [session, session], metadata, NOW), rejectsCode('invalid-response'));
  await assert.rejects(createLiveSourceSnapshot(sessionIdentity, [{ ...session, location: '' }], metadata, NOW), rejectsCode('invalid-response'));
});
test('sparse position carry keeps original row/request provenance without widening the next response window', async () => {
  const oldAt = NOW - 240_000;
  const previous = await createLiveSourceSnapshot(identity, [position(1, oldAt - 1000), position(2, oldAt - 2000)], acquisition(oldAt), oldAt);
  const next = await createLiveSourceSnapshot(identity, [position(2)], acquisition(), NOW);
  const merged = await mergeLivePositionSnapshots(previous, next, NOW);
  assert.equal(merged.coverageLower, next.coverageLower); assert.equal(merged.coverageUpper, next.coverageUpper);
  assert.deepEqual(merged.rows, next.rows);
  const carry = merged.positionCarry!.find(item => item.row.driver_number === 1)!;
  assert.equal(carry.row.date, position(1, oldAt - 1000).date);
  assert.equal(carry.acquisitionCompletedAt, oldAt); assert.equal(carry.coverageLower, previous.coverageLower);
  assert.equal(liveSourceSnapshotRows(merged).length, 3);
  await validateLiveSourceSnapshot(merged, identity, NOW);
});
test('position carry rejects foreign sessions, fabricated old coverage, newer acquisition ordering and excessive drivers', async () => {
  const previous = await createLiveSourceSnapshot(identity, [position()], acquisition(), NOW);
  const nextAt = NOW + 6000;
  const next = await createLiveSourceSnapshot(identity, [position(1, nextAt - 1000)], acquisition(nextAt), nextAt);
  const merged = await mergeLivePositionSnapshots(previous, next, nextAt);
  for (const carry of [
    { ...merged.positionCarry![0], row: { ...position(), session_key: 43 } },
    { ...merged.positionCarry![0], coverageLower: new Date(NOW).toISOString().slice(0, 19) + 'Z' },
    { ...merged.positionCarry![0], acquisitionCompletedAt: nextAt + 1 },
  ]) await assert.rejects(validateLiveSourceSnapshot({ ...merged, positionCarry: [carry] }, identity, nextAt), rejectsCode('invalid-response'));
  await assert.rejects(mergeLivePositionSnapshots({ ...previous, sessionKey: 43 }, next, nextAt), rejectsCode('invalid-response'));
  await assert.rejects(mergeLivePositionSnapshots(next, previous, nextAt), rejectsCode('invalid-response'));
  await assert.rejects(createLiveSourceSnapshot(identity, Array.from({ length: 31 }, (_, index) => position(index + 1)), acquisition(), NOW), rejectsCode('invalid-response'));
});
test('a sixteen-thousand-row position history validates completely before bounded original latest snapshots are retained', async () => {
  const history = Array.from({ length: 16000 }, (_, index) => position(index % 20 + 1, NOW - 20_000 + index));
  assert.ok(new TextEncoder().encode(JSON.stringify(history)).byteLength > 1_000_000);
  const snapshot = await createLiveSourceSnapshot(identity, history, acquisition(), NOW);
  assert.equal(snapshot.rows.length, 20);
  assert.equal(snapshot.coverageLower, acquisition().coverageLower); assert.equal(snapshot.coverageUpper, acquisition().coverageUpper);
  for (const row of snapshot.rows as Array<{ driver_number: number; date: string }>) assert.equal(row.date, history.filter(item => item.driver_number === row.driver_number).at(-1)!.date);
  assert.ok(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength < 1_000_000);
  for (const older of [{ ...history[0], session_key: 99 }, { ...history[0], position: null }, { ...history[0], date: '2026-02-30T07:00:00Z' }]) {
    await assert.rejects(createLiveSourceSnapshot(identity, [older, ...history], acquisition(), NOW), rejectsCode('invalid-response'));
  }
});
test('caller cancellation prevents raw validation and merging from publishing work', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createLiveSourceSnapshot(identity, [position()], acquisition(), NOW, controller.signal), rejectsCode('incomplete'));
  const snapshot = await createLiveSourceSnapshot(identity, [position()], acquisition(), NOW);
  await assert.rejects(validateLiveSourceSnapshot(snapshot, identity, NOW, controller.signal), rejectsCode('incomplete'));
  await assert.rejects(mergeLivePositionSnapshots(null, snapshot, NOW, controller.signal), rejectsCode('incomplete'));
});
