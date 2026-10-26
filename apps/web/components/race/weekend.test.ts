import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fastestLapOf, formatPoints, pointsLabel, gapText, parseGmtOffset, pitLaneSeconds, placesGained, reachedPart, weekendPhase, weekendSessions } from './weekend';

const base = { position: 2, positionText: '2', laps: 62, status: 'Finished', time: '+7.335' };

test('gap column shows the winner time, lead-lap gaps, laps down and status words (audit H3)', () => {
  assert.deepEqual(gapText({ ...base, position: 1, positionText: '1', time: '1:42:00.785' }, 62), { text: '1:42:00.785', timing: true });
  assert.deepEqual(gapText(base, 62), { text: '+7.335', timing: true });
  // Jolpica sends "+2.171" for a lapped car: it must read as a lap down, not a gap.
  assert.deepEqual(gapText({ ...base, laps: 61, status: 'Lapped', time: '+2.171' }, 62), { text: '+1 lap', timing: false });
  assert.deepEqual(gapText({ ...base, laps: 59, status: 'Lapped', time: '+17.347' }, 62), { text: '+3 laps', timing: false });
  // Classified but retired (empty time string): the status word, never a blank.
  assert.deepEqual(gapText({ ...base, laps: 59, status: 'Retired', time: '' }, 62), { text: 'Retired', timing: false });
  assert.deepEqual(gapText({ ...base, positionText: 'R', laps: 7, status: 'Retired', time: undefined }, 62), { text: 'Retired', timing: false });
  // Older Jolpica rows carry the laps-down count in the status.
  assert.deepEqual(gapText({ ...base, laps: 70, status: '+2 Laps', time: undefined }, 72), { text: '+2 laps', timing: false });
  assert.deepEqual(gapText({ ...base, status: 'Disqualified' }, 62), { text: 'Disqualified', timing: false });
});

test('places gained ignore pit-lane starts and unclassified finishers', () => {
  assert.equal(placesGained({ grid: 19, position: 9, positionText: '9' }), 10);
  assert.equal(placesGained({ grid: 3, position: 6, positionText: '6' }), -3);
  assert.equal(placesGained({ grid: 0, position: 12, positionText: '12' }), null);
  assert.equal(placesGained({ grid: 14, position: 22, positionText: 'R' }), null);
});

test('fastest lap, points, qualifying parts and pit-lane times read provider strings honestly', () => {
  assert.equal(fastestLapOf([{ fastestLap: { rank: 2, lap: 4, time: '1:36.9' } }, { fastestLap: { rank: 1, lap: 44, time: '1:36.2' } }])?.fastestLap?.lap, 44);
  assert.equal(fastestLapOf([{}]), null);
  assert.equal(formatPoints(25), '25');
  assert.equal(formatPoints(4.5), '4.5');
  assert.equal(formatPoints(3.14), '3.14');
  assert.equal(reachedPart({ position: '1', Q1: '1:32', Q2: '1:31', Q3: '1:31.3' }), 'Q3');
  assert.equal(reachedPart({ position: '12', Q1: '1:32', Q2: '1:31.9' }), 'Q2');
  assert.equal(reachedPart({ position: '20', Q1: '' }), null);
  assert.equal(pitLaneSeconds('24.048'), 24.048);
  assert.equal(pitLaneSeconds('1:02.500'), 62.5);
  assert.equal(pitLaneSeconds(''), null);
});

test('session phases follow OpenF1 end times, and the next session is marked once', () => {
  const sessions = [
    { kind: 'FP1', iso: '2026-10-23T17:30:00Z' },
    { kind: 'Q', iso: '2026-10-24T21:00:00Z' },
    { kind: 'R', iso: '2026-10-25T20:00:00Z' },
  ];
  const now = Date.parse('2026-10-25T12:00:00Z');
  const states = weekendSessions(sessions, now, [{ date_start: '2026-10-24T21:00:00+00:00', date_end: '2026-10-24T22:00:00+00:00' }]);
  assert.deepEqual(states.map((s) => s.phase), ['finished', 'finished', 'next']);
  assert.equal(states[1]!.endIso, '2026-10-24T22:00:00+00:00');
  assert.equal(weekendPhase(states), 'in-progress');
  const during = weekendSessions(sessions, Date.parse('2026-10-25T20:30:00Z'));
  assert.equal(during[2]!.phase, 'under-way');
  assert.equal(weekendPhase(weekendSessions(sessions, Date.parse('2026-10-26T00:00:00Z'))), 'finished');
  assert.equal(weekendPhase(weekendSessions(sessions, Date.parse('2026-10-01T00:00:00Z'))), 'upcoming');
  const cancelled = weekendSessions(sessions, now, sessions.map((s) => ({ date_start: s.iso, date_end: s.iso, is_cancelled: true })));
  assert.equal(weekendPhase(cancelled), 'cancelled');
});

test('OpenF1 gmt offsets parse to minutes and reject junk', () => {
  assert.equal(parseGmtOffset('08:00:00'), 480);
  assert.equal(parseGmtOffset('-05:00:00'), -300);
  assert.equal(parseGmtOffset('+05:30'), 330);
  assert.equal(parseGmtOffset('nope'), null);
  assert.equal(parseGmtOffset(undefined), null);
});

test('weekend dates collapse to one day, one month or a span across months and years', async () => {
  const { weekendDates } = await import('./weekend');
  assert.equal(weekendDates('1988-04-03', '1988-04-03'), '3 Apr 1988');
  assert.equal(weekendDates('2026-10-23T17:30:00Z', '2026-10-25T20:00:00Z'), '23–25 Oct 2026');
  assert.equal(weekendDates('2026-10-30T18:00:00Z', '2026-11-01T20:00:00Z'), '30 Oct – 1 Nov 2026');
  assert.equal(weekendDates('2026-12-31T10:00:00Z', '2027-01-02T10:00:00Z'), '31 Dec 2026 – 2 Jan 2027');
  assert.equal(weekendDates('nope', '2026-10-25T20:00:00Z'), '25 Oct 2026');
});

test('weekend dates follow the circuit time zone (D2-TIME-DST-1: Las Vegas 2026 is 19-21 Nov local, 20-22 Nov UTC)', async () => {
  const { weekendDates } = await import('./weekend');
  const { circuitTimeZone } = await import('./circuit-timezones');
  // FP1 Thu 19 Nov 16:30 PST = Fri 20 Nov 00:30Z; race Sat 21 Nov 20:00 PST = Sun 22 Nov 04:00Z.
  assert.equal(weekendDates('2026-11-20T00:30:00Z', '2026-11-22T04:00:00Z'), '20–22 Nov 2026');
  assert.equal(weekendDates('2026-11-20T00:30:00Z', '2026-11-22T04:00:00Z', circuitTimeZone('vegas', 'USA')), '19–21 Nov 2026');
  // Date-only seasons are already local and never shift.
  assert.equal(weekendDates('1988-04-03', '1988-04-03', 'America/Los_Angeles'), '3 Apr 1988');
  // Single-zone countries resolve by country; unknown circuits return null (callers label UTC).
  assert.equal(circuitTimeZone('marina_bay', 'Singapore'), 'Asia/Singapore');
  assert.equal(circuitTimeZone('nowhere', 'Atlantis'), null);
});

test('pit-stop time of day becomes an instant only with a published track offset', async () => {
  const { pitStopIso } = await import('./weekend');
  // Singapore 2026: race 12:00Z = 20:00 local (UTC+8); lap 18 stop at 20:33:35 local.
  assert.equal(pitStopIso('2026-10-11T12:00:00Z', '20:33:35', 480), '2026-10-11T12:33:35.000Z');
  // Race crossing local midnight (start 23:00 local, stop at 00:20 local the next day).
  assert.equal(pitStopIso('2026-10-11T15:00:00Z', '00:20:00', 480), '2026-10-11T16:20:00.000Z');
  assert.equal(pitStopIso('2026-10-11T12:00:00Z', '20:33:35', null), null);
  assert.equal(pitStopIso('2026-10-11T12:00:00Z', 'soon', 480), null);
});

test('pointsLabel is singular only for exactly one point', () => {
  assert.equal(pointsLabel(1), '1 pt');
  assert.equal(pointsLabel(0), '0 pts');
  assert.equal(pointsLabel(25), '25 pts');
  assert.equal(pointsLabel(0.5), '0.5 pts');
  assert.equal(pointsLabel(1, 'long'), '1 point');
  assert.equal(pointsLabel(90, 'long'), '90 points');
});

test('OpenF1 rows match by session name first, and the real start replaces a moved schedule (D2-DATA-TRUTH-2, Miami 2026)', async () => {
  const { weekendSessions, matchOpenF1Session } = await import('./weekend');
  const rows = [
    { session_name: 'Practice 1', date_start: '2026-05-01T16:30:00Z', date_end: '2026-05-01T17:30:00Z' },
    { session_name: 'Race', date_start: '2026-05-03T17:00:00Z', date_end: '2026-05-03T18:40:00Z' },
  ];
  // Jolpica keeps the race at 20:00Z; a pure start-time match finds nothing.
  assert.equal(matchOpenF1Session('2026-05-03T20:00:00Z', rows), null);
  assert.equal(matchOpenF1Session('2026-05-03T20:00:00Z', rows, 'R'), rows[1]);
  const [fp1, race] = weekendSessions([{ kind: 'FP1', iso: '2026-05-01T16:30:00Z' }, { kind: 'R', iso: '2026-05-03T20:00:00Z' }], Date.parse('2026-05-04T00:00:00Z'), rows);
  assert.equal(fp1!.scheduledIso, null);
  assert.equal(race!.iso, '2026-05-03T17:00:00Z');
  assert.equal(race!.scheduledIso, '2026-05-03T20:00:00Z');
  assert.equal(race!.endIso, '2026-05-03T18:40:00Z');
});

test('a circuit time zone gives the track offset when OpenF1 publishes none', async () => {
  const { zoneOffsetMinutes } = await import('./weekend');
  assert.equal(zoneOffsetMinutes('Asia/Singapore', '2026-10-11T12:00:00Z'), 480);
  assert.equal(zoneOffsetMinutes('America/Chicago', '2026-10-25T19:00:00Z'), -300);
  assert.equal(zoneOffsetMinutes('America/Los_Angeles', '2026-11-22T04:00:00Z'), -480);
  assert.equal(zoneOffsetMinutes('Europe/London', '2026-01-10T12:00:00Z'), 0);
  assert.equal(zoneOffsetMinutes(null, '2026-01-10T12:00:00Z'), null);
});

test('R3-TIME-1: a failed results read is "unavailable", never "awaiting"; an empty read waits only a day', async () => {
  const { raceResultsState } = await import('./weekend');
  // Baku 2023 (race 2023-04-30 11:00Z), read on 2026-10-26: the results service failed.
  const baku = { raceStartIso: '2023-04-30T11:00:00Z', raceDone: true, now: Date.parse('2026-10-26T04:01:00Z') };
  assert.equal(raceResultsState({ ...baku, read: 'unavailable', rows: 0 }), 'unavailable');
  assert.equal(raceResultsState({ ...baku, read: 'available', rows: 0 }), 'not-published');
  assert.equal(raceResultsState({ ...baku, read: 'available', rows: 20 }), 'classified');
  // Three hours after a race: an empty successful read is awaiting the official classification.
  const fresh = { raceStartIso: '2026-10-25T19:00:00Z', raceDone: true, now: Date.parse('2026-10-25T22:00:00Z') };
  assert.equal(raceResultsState({ ...fresh, read: 'available', rows: 0 }), 'awaiting');
  assert.equal(raceResultsState({ ...fresh, read: 'unavailable', rows: 0 }), 'unavailable');
  assert.equal(raceResultsState({ ...fresh, read: 'available', rows: 0, raceEndIso: '2026-10-25T20:40:00Z', now: Date.parse('2026-10-26T21:00:00Z') }), 'not-published');
  assert.equal(raceResultsState({ ...fresh, read: 'not-run', rows: 0, raceDone: false }), 'not-run');
});

test('sessions run in time order (R3-TIME-9: 2023 sprint weekends list the Sprint before Qualifying)', async () => {
  const { weekendSessions, chronological } = await import('./weekend');
  // Baku 2023 as Jolpica lists it: FP1, Q (Fri), SQ, S (Sat), R; the mapper's fixed order put S before Q.
  const listed = [
    { kind: 'FP1', iso: '2023-04-28T09:30:00Z' },
    { kind: 'SQ', iso: '2023-04-29T08:30:00Z' },
    { kind: 'S', iso: '2023-04-29T13:30:00Z' },
    { kind: 'Q', iso: '2023-04-28T13:00:00Z' },
    { kind: 'R', iso: '2023-04-30T11:00:00Z' },
  ];
  assert.deepEqual(weekendSessions(listed, Date.parse('2023-04-01T00:00:00Z')).map((s) => s.kind), ['FP1', 'Q', 'SQ', 'S', 'R']);
  // Date-only entries sort by day and stay stable.
  assert.deepEqual(chronological([{ iso: '1988-04-03' }, { iso: '1988-04-01' }]).map((s) => s.iso), ['1988-04-01', '1988-04-03']);
});

test('a page left open moves on: phases recompute from the browser clock (R3-TIME-6)', async () => {
  const { weekendSessions, rephase } = await import('./weekend');
  const sessions = weekendSessions([
    { kind: 'FP1', iso: '2026-10-30T18:00:00Z' },
    { kind: 'FP2', iso: '2026-10-30T22:00:00Z' },
  ], Date.parse('2026-10-30T17:00:00Z'));
  assert.deepEqual(sessions.map((s) => s.phase), ['next', 'upcoming']);
  assert.deepEqual(rephase(sessions, Date.parse('2026-10-30T18:30:00Z')).map((s) => s.phase), ['under-way', 'upcoming']);
  assert.deepEqual(rephase(sessions, Date.parse('2026-10-30T19:30:00Z')).map((s) => s.phase), ['finished', 'next']);
});

test('position and grid words never call a non-starter a pit-lane starter (R3-DATA-2, R3-DATA-3)', async () => {
  const { positionLabel, gridLabel, placesGained, lapSeconds } = await import('./weekend');
  assert.equal(positionLabel({ positionText: '4', laps: 56 }), '4');
  assert.equal(positionLabel({ positionText: 'W', laps: 2 }), 'WD');
  assert.equal(positionLabel({ positionText: 'W', laps: 0 }), 'DNS');
  assert.equal(positionLabel({ positionText: 'R', laps: 30 }), 'DNF');
  assert.equal(positionLabel({ positionText: 'D', laps: 56 }), 'DSQ');
  assert.equal(gridLabel({ grid: 0, laps: 12 }), 'Pit lane');
  assert.equal(gridLabel({ grid: 0, laps: 0 }), '–');
  assert.equal(gridLabel({ grid: 7, laps: 0 }), '7');
  assert.equal(placesGained({ grid: 0, position: 20, positionText: 'R' }), null);
  assert.equal(lapSeconds('1:32.345'), 92.345);
  assert.equal(lapSeconds('58.1'), 58.1);
  // Status-based non-start (Barrichello, Imola 1994: grid 0, no lap, "Injury") comes from lib/format.
  assert.equal(positionLabel({ positionText: 'R', laps: 0, grid: 0, status: 'Injury' }), 'DNS');
  assert.equal(lapSeconds(''), null);
});
