import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRaceClassificationSnapshot, persistRaceClassificationSnapshot, type ClassificationResult, type RaceClassificationSnapshotInput } from './classification';

function result(driverId: string, position = '1'): ClassificationResult {
  return { Driver: { driverId, givenName: `Driver ${driverId}`, familyName: 'Test', nationality: 'Test' }, Constructor: { constructorId: 'test_team', name: 'Test Team' }, position, positionText: position, points: '25', laps: '50', grid: position, status: 'Finished', Time: { millis: '5400123', time: '1:30:00.123' }, ...(position === '1' ? { FastestLap: { rank: '1', lap: '40', Time: { time: '1:31.234' } } } : {}) };
}
function snapshot(): RaceClassificationSnapshotInput {
  const results = [result('driver_a'), result('driver_b', '2'), result('driver_c', '3')];
  return { season: 2026, round: 1, results, qualifying: results.map((entry) => ({ Driver: entry.Driver, Constructor: entry.Constructor, position: entry.position, Q1: '1:31.234' })), observation: { source: 'jolpica', scope: 'classification:2026:1', generation: '1', observationId: '11111111-1111-4111-8111-111111111111' } };
}

test('classification converts strict raw timings and retains stable source entry identities', () => {
  const plan = planRaceClassificationSnapshot(snapshot());
  assert.equal(plan.results[0]?.source, 'jolpica-single-entry');
  assert.equal(plan.results[0]?.sourceEntryId, '2026:1:driver_a');
  assert.equal(plan.results[0]?.timeMs, 5_400_123);
  assert.equal(plan.results[0]?.fastestLapTimeMs, 91_234);
  assert.equal(plan.qualifying[0]?.q1Ms, 91_234);
  assert.equal(plan.qualifying[0]?.q2Ms, null);
  assert.equal(plan.drivers.length, 3);
  assert.equal(plan.teams.length, 1);
  const reordered = snapshot(); reordered.results.reverse(); reordered.qualifying.reverse();
  assert.equal(plan.contentHash, planRaceClassificationSnapshot(reordered).contentHash);
});

test('classification keeps provider milliseconds but no display for retired entries with an empty Jolpica time string', () => {
  // Observed in Jolpica 2026 round 17: a "Retired" row carries Time { millis, time: '' }.
  const input = snapshot();
  input.results[2] = { ...input.results[2]!, status: 'Retired', Time: { millis: '5998746', time: '' } };
  const plan = planRaceClassificationSnapshot(input);
  const retired = plan.results.find((row) => row.sourceEntryId === '2026:1:driver_c');
  assert.equal(retired?.timeMs, 5_998_746);
  assert.equal(retired?.gapToLeader, null);
  for (const time of [' ', ' +1.2', 'x'.repeat(65)]) {
    const invalid = snapshot(); invalid.results[2] = { ...invalid.results[2]!, Time: { millis: '5998746', time } };
    assert.throws(() => planRaceClassificationSnapshot(invalid), /time display/);
  }
});

test('classification stores no qualifying time for empty Jolpica segment strings and still rejects malformed ones', () => {
  // Observed in Jolpica 2026 qualifying (e.g. round 17 P22 Q1, other rounds Q2/Q3): a segment without a lap is ''.
  const input = snapshot();
  input.qualifying = input.qualifying.map((row, index) => index === 2 ? { ...row, Q1: '', Q2: '', Q3: '' } : row);
  const plan = planRaceClassificationSnapshot(input);
  const row = plan.qualifying.find((entry) => entry.position === 3);
  assert.equal(row?.q1Ms, null); assert.equal(row?.q2Ms, null); assert.equal(row?.q3Ms, null);
  for (const value of [' ', 'DNF', '1:31']) {
    const invalid = snapshot(); invalid.qualifying = invalid.qualifying.map((entry, index) => index === 2 ? { ...entry, Q2: value } : entry);
    assert.throws(() => planRaceClassificationSnapshot(invalid), /Q2 time/);
  }
});

test('classification distinguishes optional untouched datasets from complete zero-count provider responses', () => {
  const plan = planRaceClassificationSnapshot(snapshot());
  assert.equal(plan.sprintResults, undefined); assert.equal(plan.pitStops, undefined); assert.equal(plan.laps, undefined);
  const empty = snapshot(); empty.results = []; empty.qualifying = []; empty.sprintResults = []; empty.pitStops = []; empty.laps = [];
  const emptyPlan = planRaceClassificationSnapshot(empty);
  assert.deepEqual(emptyPlan.results, []); assert.deepEqual(emptyPlan.qualifying, []); assert.deepEqual(emptyPlan.sprintResults, []); assert.deepEqual(emptyPlan.pitStops, []); assert.deepEqual(emptyPlan.laps, []);
});

test('classification rejects missing required complete datasets and sparse arrays before writing', () => {
  const missing = snapshot(); (missing as unknown as Record<string, unknown>).qualifying = undefined;
  assert.throws(() => planRaceClassificationSnapshot(missing), /complete qualifying/);
  const sparse = snapshot(); sparse.results = new Array<ClassificationResult>(1);
  assert.throws(() => planRaceClassificationSnapshot(sparse), /complete results/);
  const sparseTimings = snapshot(); sparseTimings.laps = [{ number: '1', Timings: new Array(1) }];
  assert.throws(() => planRaceClassificationSnapshot(sparseTimings), /complete lap timings/);
});

test('classification rejects duplicate driver entries instead of silently collapsing historical classifications', () => {
  const duplicate = snapshot(); duplicate.results.push({ ...duplicate.results[0]!, position: '4' });
  assert.throws(() => planRaceClassificationSnapshot(duplicate), /duplicate result driver/);
  const duplicateQualifying = snapshot(); duplicateQualifying.qualifying.push({ ...duplicateQualifying.qualifying[0]!, position: '4' });
  assert.throws(() => planRaceClassificationSnapshot(duplicateQualifying), /duplicate qualifying driver/);
});

test('classification rejects duplicate positions and conflicting identity metadata across complete datasets', () => {
  const duplicate = snapshot(); duplicate.results[1]!.position = '1';
  assert.throws(() => planRaceClassificationSnapshot(duplicate), /duplicate result position/);
  const conflicting = snapshot(); conflicting.qualifying[0]!.Driver = { ...conflicting.qualifying[0]!.Driver, familyName: 'Different' };
  assert.throws(() => planRaceClassificationSnapshot(conflicting), /Conflicting identity/);
  const conflictingTeam = snapshot(); conflictingTeam.qualifying[0]!.Constructor = { constructorId: 'test_team', name: 'Different' };
  assert.throws(() => planRaceClassificationSnapshot(conflictingTeam), /Conflicting identity/);
});

test('classification validates the final row identity and preserves missing optional fields without synthetic teams', () => {
  const invalidLast = snapshot(); invalidLast.results[2]!.Driver.givenName = '';
  assert.throws(() => planRaceClassificationSnapshot(invalidLast), /driver first name/);
  const absentTeam = snapshot(); absentTeam.results[2]!.Constructor = undefined;
  absentTeam.results[2]!.laps = undefined; absentTeam.results[2]!.grid = undefined; absentTeam.results[2]!.status = undefined;
  const plan = planRaceClassificationSnapshot(absentTeam);
  assert.equal(plan.results[2]!.teamSlug, null); assert.equal(plan.results[2]!.laps, null); assert.equal(plan.results[2]!.grid, null); assert.equal(plan.results[2]!.status, 'Unknown');
});

test('classification rejects malformed, non-finite and out-of-bound numeric values', () => {
  for (const points of ['NaN', 'Infinity', '-1', '1e9', ' 25', '10001']) {
    const invalid = snapshot(); invalid.results[0]!.points = points;
    assert.throws(() => planRaceClassificationSnapshot(invalid), /points/);
  }
  for (const position of ['0', '-1', '1.5', '101', '01']) {
    const invalid = snapshot(); invalid.results[0]!.position = position;
    assert.throws(() => planRaceClassificationSnapshot(invalid), /position/);
  }
});

test('classification validates actual birth dates, URL schemes and fastest-lap evidence', () => {
  const birth = snapshot(); birth.results[0]!.Driver.dateOfBirth = '2024-02-30';
  assert.throws(() => planRaceClassificationSnapshot(birth), /birth date/);
  const url = snapshot(); url.results[0]!.Driver.url = 'javascript:alert(1)';
  assert.throws(() => planRaceClassificationSnapshot(url), /driver URL/);
  const tooLate = snapshot(); tooLate.results[0]!.FastestLap!.lap = '51';
  assert.throws(() => planRaceClassificationSnapshot(tooLate), /fastest lap number/);
  const invalidTime = snapshot(); invalidTime.qualifying[0]!.Q1 = '1:60.123';
  assert.throws(() => planRaceClassificationSnapshot(invalidTime), /Q1 time/);
});

test('classification validates pit/lap natural identities and converts durations without inferring missing drivers', () => {
  const input = snapshot(); input.pitStops = [{ driverId: 'driver_a', lap: '5', time: '13:05:23', duration: '22.115', stop: '1' }];
  input.laps = [{ number: '1', Timings: [{ driverId: 'driver_a', position: '1', time: '1:30.456' }, { driverId: 'existing_driver', position: '2', time: '1:31.1' }] }];
  const plan = planRaceClassificationSnapshot(input);
  assert.equal(plan.pitStops?.[0]?.durationMs, 22_115); assert.equal(plan.laps?.[1]?.timeMs, 91_100);
  assert.ok(plan.driverSlugs.includes('existing_driver')); assert.ok(!plan.drivers.some((entry) => entry.slug === 'existing_driver'));
  input.pitStops.push(input.pitStops[0]!);
  assert.throws(() => planRaceClassificationSnapshot(input), /duplicate pit stop/);
});

test('classification accepts authoritative red-flag pit durations including minute and hour forms', () => {
  for (const [duration, milliseconds] of [['22.115', 22_115], ['40:55.302', 2_455_302], ['1:40:55.302', 6_055_302]] as const) {
    const input = snapshot(); input.pitStops = [{ driverId: 'driver_a', lap: '1', time: '13:00:00', duration }];
    assert.equal(planRaceClassificationSnapshot(input).pitStops?.[0]?.durationMs, milliseconds);
  }
  for (const duration of ['1:60.123', '1:60:01.123', '-1', '22.1234', '25:00:00.000']) {
    const input = snapshot(); input.pitStops = [{ driverId: 'driver_a', lap: '1', time: '13:00:00', duration }];
    assert.throws(() => planRaceClassificationSnapshot(input), /pit stop duration/);
  }
});

test('classification rejects duplicate laps, empty timing rows and malformed stop times', () => {
  const input = snapshot(); input.laps = [{ number: '1', Timings: [{ driverId: 'driver_a', position: '1', time: '1:30.456' }] }];
  input.laps.push(input.laps[0]!);
  assert.throws(() => planRaceClassificationSnapshot(input), /duplicate lap number/);
  input.laps = [{ number: '1', Timings: [{ driverId: 'driver_a', position: '1', time: '1:30.456' }] }, { number: '1', Timings: [{ driverId: 'driver_b', position: '1', time: '1:30.789' }] }];
  assert.throws(() => planRaceClassificationSnapshot(input), /duplicate lap number/);
  input.laps = [{ number: '1', Timings: [] }];
  assert.throws(() => planRaceClassificationSnapshot(input), /must have timings/);
  input.laps = undefined; input.pitStops = [{ driverId: 'driver_a', lap: '1', time: '24:00:00', duration: '22' }];
  assert.throws(() => planRaceClassificationSnapshot(input), /time of day/);
});

test('classification bounds complete provider snapshots and expanded lap timing counts', () => {
  const large = snapshot(); large.results = Array.from({ length: 101 }, (_, i) => result(`driver_${i}`, String(i + 1)));
  assert.throws(() => planRaceClassificationSnapshot(large), /complete results/);
  const tooManyLaps = snapshot(); tooManyLaps.laps = Array.from({ length: 121 }, (_, i) => ({ number: String(i + 1), Timings: Array.from({ length: 100 }, (_, j) => ({ driverId: `driver_${j}`, position: String(j + 1), time: '1:30.456' })) }));
  assert.throws(() => planRaceClassificationSnapshot(tooManyLaps), /12000 timings/);
});

test('classification grading fingerprint ignores telemetry edits but follows relevant classification corrections', () => {
  const initial = snapshot(); const initialHash = planRaceClassificationSnapshot(initial).contentHash;
  initial.pitStops = [{ driverId: 'driver_a', lap: '2', time: '13:00:00', duration: '21.3' }];
  initial.results[0]!.points = '12.5'; initial.results[0]!.Time = { millis: '5400124', time: '1:30:00.124' };
  assert.equal(planRaceClassificationSnapshot(initial).contentHash, initialHash);
  initial.qualifying[0]!.position = '2'; initial.qualifying[1]!.position = '1';
  assert.notEqual(planRaceClassificationSnapshot(initial).contentHash, initialHash);
});

test('classification rejects wrong, missing and malformed source observations before any persistence', () => {
  for (const change of [{ source: 'other' }, { scope: 'classification:2026:2' }, { generation: '0' }, { observationId: 'not-a-uuid' }]) {
    const input = snapshot(); Object.assign(input.observation, change);
    assert.throws(() => planRaceClassificationSnapshot(input), /observation/);
  }
});

test('classification public writer refuses absent database configuration without contacting any service', async () => {
  const previous = process.env.DATABASE_URL;
  try { delete process.env.DATABASE_URL; await assert.rejects(persistRaceClassificationSnapshot(snapshot()), /not configured/); }
  finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
