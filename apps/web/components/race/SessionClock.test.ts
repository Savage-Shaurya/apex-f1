import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatClock } from './SessionClock';

test('track time shifts by the OpenF1 offset and UTC stays UTC', () => {
  const iso = '2026-10-25T20:00:00Z';
  assert.equal(formatClock(iso, 'utc', null), '20:00');
  assert.equal(formatClock(iso, 'track', -300), '15:00');
  assert.equal(formatClock(iso, 'track', 480, 'day-time'), 'Mon 26 Oct, 04:00');
  // Without a published offset, "track" falls back to UTC rather than guessing a zone.
  assert.equal(formatClock(iso, 'track', null), '20:00');
  assert.equal(formatClock('not a date', 'utc', null), 'Time to be confirmed');
});

test('clock names fit inside the reserved sizer so hydration cannot reflow the calendar lead', async () => {
  const { clockNameText, CLOCK_NAME_SIZER } = await import('./SessionClock');
  assert.equal(clockNameText('utc', null, null, null), 'UTC');
  // R3-TIME-8: legacy ids read as today's name.
  assert.equal(clockNameText('local', null, null, 'Asia/Calcutta'), 'your time (Asia/Kolkata)');
  assert.equal(clockNameText('track', 480, 'Marina Bay time', null), 'Marina Bay time (UTC+8)');
  // R3-TIME-5: with the circuit's zone no fixed offset is printed (it can change mid-weekend).
  assert.equal(clockNameText('track', -300, 'Mexico City time', null, 'America/Mexico_City'), 'Mexico City time');
  for (const zone of ['Asia/Calcutta', 'America/Los_Angeles', 'Europe/London', 'Australia/Melbourne', 'America/Argentina/Cordoba']) {
    assert.ok(clockNameText('local', null, null, zone).length <= CLOCK_NAME_SIZER.length, zone);
  }
});

test('circuit time follows the zone per session across a DST change (R3-TIME-5, Mexico City 2022)', () => {
  // Mexico left DST on 30 Oct 2022: FP1 Fri 28 Oct 18:00Z was 13:00 local (UTC-5), the race Sun 30 Oct 20:00Z was 14:00 (UTC-6).
  assert.equal(formatClock('2022-10-28T18:00:00Z', 'track', -360, 'time', 'America/Mexico_City'), '13:00');
  assert.equal(formatClock('2022-10-30T20:00:00Z', 'track', -360, 'time', 'America/Mexico_City'), '14:00');
  // No zone: the fixed offset is the fallback.
  assert.equal(formatClock('2022-10-28T18:00:00Z', 'track', -360, 'time', null), '12:00');
});
