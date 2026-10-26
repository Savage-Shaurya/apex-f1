import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarFocusIndex, CALENDAR_FOCUS_WINDOW_MS } from './calendar-window';

test('calendar focus stays on the same weekend across lights out and advances at the shared boundary', () => {
  const start = Date.parse('2026-10-04T07:00:00Z');
  const races = [{ raceStartIso: 'invalid' }, { raceStartIso: new Date(start).toISOString() },
    { raceStartIso: new Date(start + 7 * 86_400_000).toISOString() }];
  assert.equal(calendarFocusIndex(races, start - 1), 1);
  assert.equal(calendarFocusIndex(races, start), 1);
  assert.equal(calendarFocusIndex(races, start + CALENDAR_FOCUS_WINDOW_MS - 1), 1);
  assert.equal(calendarFocusIndex(races, start + CALENDAR_FOCUS_WINDOW_MS), 2);
  assert.equal(calendarFocusIndex(races, start + 8 * 86_400_000), -1);
  assert.equal(calendarFocusIndex([], start), -1);
  assert.equal(calendarFocusIndex(races, Number.NaN), -1);
});
