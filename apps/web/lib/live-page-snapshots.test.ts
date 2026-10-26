import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestDatedByDriver, latestDatedSample, latestStintByDriver } from './live-page-snapshots';

test('shuffled position and interval samples select each driver by timestamp rather than array order', () => {
  const rows = [
    { driver_number: 1, date: '2026-03-01T12:02:00Z', position: 1, gap: 0 },
    { driver_number: 2, date: '2026-03-01T12:03:00Z', position: 2, gap: 1 },
    { driver_number: 1, date: '2026-03-01T12:01:00Z', position: 4, gap: 3 },
    { driver_number: 2, date: 'invalid', position: 5, gap: 4 },
  ];
  const unchanged = structuredClone(rows);
  const selected = latestDatedByDriver(rows);
  assert.equal(selected.get(1)?.position, 1); assert.equal(selected.get(1)?.gap, 0);
  assert.equal(selected.get(2)?.position, 2); assert.deepEqual(rows, unchanged);
});

test('weather and other session samples use the newest reported instant, including zone offsets', () => {
  assert.equal(latestDatedSample([{ date: '2026-03-01T14:02:00+02:00', air: 25 }, { date: '2026-03-01T12:01:00Z', air: 22 }, { date: 'invalid', air: 50 }])?.air, 25);
  assert.equal(latestDatedSample([]), undefined);
});

test('shuffled stint arrays choose maximum stint number and the latest reported end lap', () => {
  const latest = latestStintByDriver([
    { driver_number: 1, stint_number: 2, lap_end: 40, compound: 'HARD' },
    { driver_number: 2, stint_number: 3, lap_end: 55, compound: 'SOFT' },
    { driver_number: 1, stint_number: 1, lap_end: 15, compound: 'MEDIUM' },
    { driver_number: 1, stint_number: 2, lap_end: 42, compound: 'HARD' },
  ]);
  assert.equal(latest.get(1)?.compound, 'HARD'); assert.equal(latest.get(1)?.lap_end, 42);
  assert.equal(latest.get(2)?.stint_number, 3);
  const unknown = latestStintByDriver([{ driver_number: 1, stint_number: 1, lap_end: 20 }, { driver_number: 1, stint_number: 2, lap_end: null }]);
  assert.equal(unknown.get(1)?.stint_number, 2); assert.equal(unknown.get(1)?.lap_end, null);
});
