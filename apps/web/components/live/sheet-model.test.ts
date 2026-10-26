import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildClassification,
  canonicalNames,
  deletedLapKeys,
  fastestLap,
  fastestPerSegment,
  finishedSessions,
  formatGap,
  formatLapTime,
  nextSession,
  niceAxis,
  pointAt,
  officialBest,
  positionChange,
  projectTrace,
  qualiCaption,
  rankedTop,
  qualifyingCuts,
  ribbonLanes,
  sessionClock,
  sessionKind,
  shortSessionName,
  speedAxis,
  speedTrap,
  stintBars,
  type DriverInfo,
  type SessionLike,
} from './sheet-model';
import { normaliseResultRow, validResultRow, type SessionResultRow } from './openf1-history';
import { bandExtent, bandWindow, chequeredFlags, flagBand, idleShare, messageGroup, runningPeriods, yellowMoments, type RcMessage } from './race-control-model';

const driver = (n: number, code: string): DriverInfo => ({ number: n, code, firstName: 'First', lastName: code, team: 'Team', color: '#3671c6', headshot: null });
const drivers = new Map([12, 3, 6, 30, 10, 18].map((n, i) => [n, driver(n, ['ANT', 'VER', 'HAD', 'LAW', 'GAS', 'STR'][i]!)]));

const session = (key: number, name: string, type: string, start: string, end: string, extra: Partial<SessionLike> = {}): SessionLike => ({
  session_key: key, session_name: name, session_type: type, date_start: start, date_end: end, meeting_key: 1, location: 'Austin', ...extra,
});

test('session kinds come from OpenF1 type and name', () => {
  assert.equal(sessionKind({ session_type: 'Race', session_name: 'Sprint' }), 'sprint');
  assert.equal(sessionKind({ session_type: 'Race', session_name: 'Race' }), 'race');
  assert.equal(sessionKind({ session_type: 'Qualifying', session_name: 'Sprint Qualifying' }), 'sprint-qualifying');
  assert.equal(sessionKind({ session_type: 'Qualifying', session_name: 'Qualifying' }), 'qualifying');
  assert.equal(sessionKind({ session_type: 'Practice', session_name: 'Practice 2' }), 'practice');
  assert.equal(shortSessionName('Practice 3'), 'FP3');
});

test('only finished, non-cancelled, non-test sessions can be shown, newest first; the next session is the first future one', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const list = [
    session(1, 'Day 1', 'Practice', '2026-02-11T07:00:00Z', '2026-02-11T16:00:00Z'),
    session(2, 'Qualifying', 'Qualifying', '2026-10-24T21:00:00Z', '2026-10-24T22:00:00Z'),
    session(3, 'Practice 3', 'Practice', '2026-10-24T17:30:00Z', '2026-10-24T18:30:00Z'),
    session(4, 'Race', 'Race', '2026-10-25T20:00:00Z', '2026-10-25T22:00:00Z'),
    session(5, 'Practice 1', 'Practice', '2026-10-23T17:30:00Z', '2026-10-23T18:30:00Z', { is_cancelled: true }),
  ];
  assert.deepEqual(finishedSessions(list, now).map((s) => s.session_key), [2, 3]);
  assert.equal(nextSession(list, now)?.session_key, 4);
  // A race in progress is neither finished nor next.
  assert.deepEqual(finishedSessions(list, Date.parse('2026-10-25T21:00:00Z')).map((s) => s.session_key), [2, 3]);
});

test('times and gaps are words and real values, never blanks', () => {
  assert.equal(formatLapTime(94.035), '1:34.035');
  assert.equal(formatLapTime(6120.785), '1:42:00.785');
  assert.equal(formatLapTime(null), null);
  assert.equal(formatGap(0.179), '+0.179');
  assert.equal(formatGap('+1 LAP'), '+1 lap');
  assert.equal(formatGap('+2 LAPS'), '+2 laps');
  assert.equal(formatGap('nonsense'), null);
  // Over a minute the sheet prints minutes, as the FIA classification does.
  assert.equal(formatGap(81.666), '+1:21.666');
  assert.equal(formatGap(59.9994), '+59.999');
  assert.equal(formatGap(-1), null);
});

test('qualifying cut lines follow the field size', () => {
  assert.deepEqual(qualifyingCuts(22), { q2: 16, q3: 10 });
  assert.deepEqual(qualifyingCuts(20), { q2: 15, q3: 10 });
});

const quali: SessionResultRow[] = [
  { session_key: 9, driver_number: 12, position: 1, number_of_laps: 18, dnf: false, dns: false, dsq: false, duration: [95.39, 94.278, 94.035], gap_to_leader: [0.361, 0.08, 0] },
  { session_key: 9, driver_number: 3, position: 2, number_of_laps: 12, dnf: false, dns: false, dsq: false, duration: [95.215, 94.471, 94.214], gap_to_leader: [0.186, 0.273, 0.179] },
  { session_key: 9, driver_number: 30, position: 10, number_of_laps: 9, dnf: false, dns: false, dsq: false, duration: [95.662, 95.058, null], gap_to_leader: [0.633, 0.86, null] },
  { session_key: 9, driver_number: 10, position: 11, number_of_laps: 9, dnf: false, dns: false, dsq: false, duration: [95.969, 95.08, null], gap_to_leader: [0.94, 0.882, null] },
  { session_key: 9, driver_number: 18, position: 22, number_of_laps: 6, dnf: false, dns: false, dsq: false, duration: [97.5, null, null], gap_to_leader: [2.5, null, null] },
];

test('a Q3 runner without a Q3 time shows no gap (Q2 gaps do not compare with Q3), Q2 drivers keep their Q2 gap', () => {
  const rows = buildClassification('qualifying', quali, drivers);
  const law = rows.find((r) => r.number === 30)!;
  const gas = rows.find((r) => r.number === 10)!;
  assert.equal(law.group, 3);
  assert.equal(law.gap, null);
  assert.equal(law.gapSeconds, null);
  // No Q3 lap: no classified time, but the real best (Q2) is kept with its segment.
  assert.equal(law.time, null);
  assert.equal(law.timeSegment, 2);
  assert.deepEqual(law.best, { time: 95.058, segment: 1 });
  assert.equal(gas.group, 2);
  assert.equal(gas.gap, '+0.882');
  assert.equal(rows[0]!.gap, null);
  assert.equal(rows[1]!.gap, '+0.179');
  assert.equal(rows.at(-1)!.group, 1);
  assert.equal(rows.at(-1)!.gap, '+2.500');
  assert.equal(fastestPerSegment(rows).get(2), 12);
  assert.equal(fastestPerSegment(rows).get(0), 3);
});

test('qualifying best time is the fastest segment, not the last one', () => {
  const slowerInQ3: SessionResultRow[] = [
    ...quali.slice(0, 2),
    { session_key: 9, driver_number: 6, position: 3, number_of_laps: 15, dnf: false, dns: false, dsq: false, duration: [95.4, 94.95, 96.049], gap_to_leader: [0.37, 0.67, 2.014] },
  ];
  const had = buildClassification('qualifying', slowerInQ3, drivers).find((r) => r.number === 6)!;
  assert.equal(had.time, 96.049);
  assert.equal(had.timeSegment, 2);
  assert.deepEqual(had.best, { time: 94.95, segment: 1 });
  const ant = buildClassification('qualifying', slowerInQ3, drivers)[0]!;
  assert.deepEqual(ant.best, { time: 94.035, segment: 2 });
});

test('race rows: lapped cars read "+1 lap", retirements read DNF, grid change comes from the starting grid', () => {
  const race: SessionResultRow[] = [
    { session_key: 8, driver_number: 3, position: 1, number_of_laps: 62, dnf: false, dns: false, dsq: false, duration: 6120.785, gap_to_leader: 0, points: 25 },
    { session_key: 8, driver_number: 10, position: 11, number_of_laps: 61, dnf: false, dns: false, dsq: false, duration: null, gap_to_leader: '+1 LAP', points: 0 },
    { session_key: 8, driver_number: 18, position: null, number_of_laps: 36, dnf: true, dns: false, dsq: false, duration: null, gap_to_leader: null, points: 0 },
  ];
  const rows = buildClassification('race', race, drivers, [{ session_key: 7, driver_number: 3, position: 2, lap_duration: 91.4 }]);
  assert.equal(rows[0]!.time, 6120.785);
  assert.equal(rows[1]!.gap, '+1 lap');
  assert.equal(rows[2]!.status, 'DNF');
  assert.equal(positionChange(rows[0]!), 1);
  assert.equal(positionChange(rows[2]!), null);
});

test('result rows from another session or with invented gap strings are rejected', () => {
  assert.equal(validResultRow(quali[0], 9), true);
  assert.equal(validResultRow(quali[0], 10), false);
  assert.equal(validResultRow({ ...quali[0], gap_to_leader: 'fast' }, 9), false);
});

test('gap ribbon labels never share a lane closer than the minimum spacing', () => {
  const rows = buildClassification('practice', [
    { session_key: 1, driver_number: 12, position: 1, number_of_laps: 20, dnf: false, dns: false, dsq: false, duration: 94.8, gap_to_leader: 0 },
    { session_key: 1, driver_number: 3, position: 2, number_of_laps: 20, dnf: false, dns: false, dsq: false, duration: 94.81, gap_to_leader: 0.01 },
    { session_key: 1, driver_number: 6, position: 3, number_of_laps: 20, dnf: false, dns: false, dsq: false, duration: 94.82, gap_to_leader: 0.02 },
    { session_key: 1, driver_number: 30, position: 4, number_of_laps: 20, dnf: false, dns: false, dsq: false, duration: 95.8, gap_to_leader: 1 },
  ], drivers);
  const { points, max } = ribbonLanes(rows, 3, 0.05);
  assert.equal(max, 1);
  assert.deepEqual(points.slice(0, 3).map((p) => p.lane), [0, 1, 2]);
  assert.equal(points[3]!.lane, 0);
  assert.deepEqual(niceAxis(0.86), { max: 1, step: 0.2 });
});

test('session clock uses the circuit offset for local time', () => {
  assert.deepEqual(sessionClock('2026-10-24T21:00:00+00:00', '-05:00:00'), { day: 'Sat 24 Oct', utc: '21:00', local: '16:00', localDay: 'Sat 24 Oct' });
});

test('track: fastest complete lap ignores pit-out laps; trace keeps aspect and lap-relative time', () => {
  const laps = [
    { driver_number: 1, lap_number: 3, lap_duration: 93.1, date_start: '2026-10-24T21:10:00Z', is_pit_out_lap: true, st_speed: 330 },
    { driver_number: 12, lap_number: 14, lap_duration: 94.035, date_start: '2026-10-24T21:50:00Z', is_pit_out_lap: false, st_speed: 328 },
    { driver_number: 3, lap_number: 9, lap_duration: 94.2, date_start: '2026-10-24T21:40:00Z', is_pit_out_lap: false, st_speed: 341 },
  ];
  assert.equal(fastestLap(laps)?.driver_number, 12);
  assert.deepEqual(speedTrap(laps).map((s) => s.driver), [3, 1, 12]);
  const trace = projectTrace([
    { x: 0, y: 10, date: '2026-10-24T21:50:00.000Z' },
    { x: 100, y: 10, date: '2026-10-24T21:50:01.000Z' },
    { x: 100, y: 60, date: '2026-10-24T21:50:02.000Z' },
  ], '2026-10-24T21:50:00Z', 1000, 0);
  assert.equal(trace.height, 500);
  assert.deepEqual(trace.points.map((p) => p.t), [0, 1, 2]);
  assert.equal(trace.points[2]!.y, 0);
  assert.equal(pointAt(trace.points, 1.5), 1);
});

test('strategy bars stop at the laps a driver completed', () => {
  const bars = stintBars([
    { stint_number: 2, compound: 'HARD', lap_start: 20, lap_end: 62 },
    { stint_number: 1, compound: 'MEDIUM', lap_start: 1, lap_end: 19 },
  ], 36);
  assert.deepEqual(bars, [{ compound: 'medium', start: 1, end: 19 }, { compound: 'hard', start: 20, end: 36 }]);
});

test('race control: groups, safety-car periods, red flags and qualifying segments come only from messages', () => {
  const m = (date: string, category: string, message: string, extra: Partial<RcMessage> = {}): RcMessage => ({ date: `2026-10-11T${date}Z`, category, message, ...extra });
  const log = [
    m('12:00:00', 'SessionStatus', 'SESSION STARTED'),
    m('12:10:00', 'SafetyCar', 'VSC DEPLOYED'),
    m('12:11:00', 'SafetyCar', 'VSC ENDING'),
    m('12:20:00', 'Flag', 'YELLOW IN TRACK SECTOR 4', { flag: 'YELLOW', scope: 'Sector', sector: 4 }),
    m('12:30:00', 'Flag', 'RED FLAG', { flag: 'RED', scope: 'Track' }),
    m('12:45:00', 'SessionStatus', 'SESSION RESUMED'),
    m('12:50:00', 'Flag', 'BLUE FLAG FOR CAR 18 (STR)', { flag: 'BLUE', scope: 'Driver' }),
    m('12:55:00', 'Other', 'FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 12 (ANT) AND 3 (VER) NOTED'),
    m('13:40:00', 'Flag', 'CHEQUERED FLAG', { flag: 'CHEQUERED', scope: 'Track' }),
    m('13:40:00', 'SessionStatus', 'SESSION FINISHED'),
  ];
  assert.equal(messageGroup(log[6]!), 'blue');
  assert.equal(messageGroup(log[7]!), 'stewards');
  assert.equal(messageGroup(log[1]!), 'safety-car');
  const win = bandWindow(log, Date.parse('2026-10-11T11:55:00Z'), Date.parse('2026-10-11T14:00:00Z'));
  assert.equal(win.start, Date.parse('2026-10-11T12:00:00Z'));
  assert.equal(win.end, Date.parse('2026-10-11T13:40:00Z'));
  const band = flagBand(log, win.end);
  assert.deepEqual(band.periods.map((p) => p.kind), ['vsc', 'red']);
  assert.equal(band.periods[1]!.to, Date.parse('2026-10-11T12:45:00Z'));
  assert.equal(band.marks.length, 1);
  assert.equal(runningPeriods(log, win.end).length, 1);
});

test('flags shown after the chequered flag extend the band instead of hiding behind it', () => {
  const at = (hms: string) => `2026-10-24T${hms}+00:00`;
  const msgs: RcMessage[] = [
    { date: at('21:47:00'), category: 'SessionStatus', message: 'SESSION STARTED' },
    { date: at('21:18:00'), category: 'Flag', flag: 'CHEQUERED', scope: 'Track', message: 'CHEQUERED FLAG' },
    { date: at('22:00:00'), category: 'Flag', flag: 'CHEQUERED', scope: 'Track', message: 'CHEQUERED FLAG' },
    { date: at('22:05:54'), category: 'Flag', flag: 'YELLOW', scope: 'Sector', sector: 7, message: 'YELLOW IN TRACK SECTOR 7' },
  ];
  const flag = Date.parse(at('22:00:00'));
  const band = flagBand(msgs, flag);
  assert.equal(band.marks.length, 1);
  assert.equal(bandExtent(band.marks, band.periods, flag), Date.parse(at('22:06:54')));
  // Nothing after the flag: the band ends at the flag.
  assert.equal(bandExtent([], [], flag), flag);
  // A stray message an hour later does not stretch the band.
  assert.equal(bandExtent([{ at: flag + 3_600_000, kind: 'yellow', sector: 1 }], [], flag), flag);
  assert.deepEqual(chequeredFlags(msgs), [Date.parse(at('21:18:00')), flag]);
});

test('speed-trap scale keeps every reading inside the frame on round numbers', () => {
  const a = speedAxis(326, 341);
  assert.equal(a.min, 325);
  assert.equal(a.max, 345);
  assert.deepEqual(a.ticks, [325, 330, 335, 340, 345]);
  assert.ok(a.at(326) > 0 && a.at(341) < 100);
  assert.equal(speedAxis(280, 340).ticks[1]! - speedAxis(280, 340).ticks[0]!, 10);
});

test('timing sheet uses the official driver names but keeps the team OpenF1 timed in this session', () => {
  const d = (n: number, code: string, first: string, last: string, team: string): DriverInfo => ({ number: n, code, firstName: first, lastName: last, team, color: null, headshot: null });
  const openf1 = new Map([
    [12, d(12, 'ANT', 'Kimi', 'Antonelli', 'Mercedes')],
    [30, d(30, 'LAW', 'Liam', 'Lawson', 'Racing Bulls')],
    [99, d(99, 'XYZ', 'Test', 'Driver', 'Alpine')],
  ]);
  const official = [
    { code: 'ANT', number: 12, firstName: 'Andrea Kimi', lastName: 'Antonelli' },
    { code: 'LAW', number: 30, firstName: 'Liam', lastName: 'Lawson', team: 'RB F1 Team' },
  ];
  const out = canonicalNames(openf1, official);
  assert.equal(out.get(12)!.firstName, 'Andrea Kimi');
  assert.equal(out.get(30)!.team, 'Racing Bulls');
  assert.equal(out.get(99)!.firstName, 'Test');
  // A different car number is a different entry: names stay as OpenF1 sent them.
  const other = canonicalNames(new Map([[7, d(7, 'ANT', 'Kimi', 'Antonelli', 'Mercedes')]]), official);
  assert.equal(other.get(7)!.firstName, 'Kimi');
});

test('fastest lap: deleted laps never count; practice and qualifying follow the official best time (Austin FP3)', () => {
  const lap = (driver: number, n: number, t: number) => ({ driver_number: driver, lap_number: n, lap_duration: t, date_start: '2026-10-24T18:10:00Z', is_pit_out_lap: false });
  const laps = [lap(16, 12, 94.81), lap(44, 12, 94.893), lap(12, 8, 95.015), lap(3, 10, 95.061)];
  const messages = [
    { date: '2026-10-24T18:14:16Z', message: 'CAR 12 (ANT) TIME 1:35.015 DELETED - TRACK LIMITS AT TURN 9 LAP 9 13:11:07' },
    { date: '2026-10-24T18:19:31Z', message: 'CAR 16 (LEC) TIME 1:34.810 DELETED - TRACK LIMITS AT TURN 10 LAP 13 13:17:43' },
    { date: '2026-10-24T18:20:00Z', message: 'CAR 43 (COL) LAP DELETED - TRACK LIMITS AT TURN 1 LAP 13 12:49:19 (PIT)' },
  ];
  const deleted = deletedLapKeys(messages);
  assert.deepEqual([...deleted].sort(), ['12|1:35.015', '16|1:34.810']);
  assert.equal(fastestLap(laps)?.driver_number, 16);
  assert.equal(fastestLap(laps, { deleted })?.driver_number, 44);
  // Reinstated later: the lap counts again.
  const back = deletedLapKeys([...messages, { date: '2026-10-24T18:30:00Z', message: 'CAR 16 (LEC) TIME 1:34.810 WILL BE REINSTATED' }]);
  assert.equal(back.has('16|1:34.810'), false);
  // The classification decides in practice: HAM 1:34.893 is P1.
  const rows = buildClassification('practice', [
    { position: 1, driver_number: 44, number_of_laps: 21, duration: 94.893, gap_to_leader: 0 },
    { position: 2, driver_number: 3, number_of_laps: 16, duration: 95.061, gap_to_leader: 0.168 },
  ] as SessionResultRow[], new Map());
  const official = officialBest('practice', rows);
  assert.deepEqual(official, { driver: 44, time: 94.893 });
  assert.equal(fastestLap(laps, { official })?.lap_number, 12);
  assert.equal(fastestLap(laps, { official })?.driver_number, 44);
  // A best time the lap feed does not hold returns nothing rather than another lap.
  assert.equal(fastestLap(laps, { official: { driver: 44, time: 94.5 } }), null);
  assert.equal(officialBest('race', rows), null);
});

test('speed-trap ranks share places and a tie at tenth keeps every tied car', () => {
  const rows = [341, 341, 337, 333, 331, 330, 330, 326, 326, 326, 326, 326, 320].map((speed, i) => ({ driver: i + 1, speed }));
  const top = rankedTop(rows, 10);
  assert.equal(top.length, 12);
  assert.deepEqual(top.slice(0, 3).map((r) => r.rank), [1, 1, 3]);
  assert.deepEqual(top.slice(7).map((r) => r.rank), [8, 8, 8, 8, 8]);
  assert.equal(top[0]!.tied, true);
  assert.equal(top[2]!.tied, false);
  assert.equal(rankedTop(rows.slice(0, 3), 10).length, 3);
});

test('phone qualifying caption keeps each phrase whole with non-breaking spaces', () => {
  const parts = qualiCaption({ time: 96.049, timeSegment: 2, best: { time: 94.95, segment: 1 } }, ['Q1', 'Q2', 'Q3']);
  assert.deepEqual(parts, ['Q3\u00a01:36.049', 'Best\u00a01:34.950\u00a0(Q2)']);
  assert.ok(parts.every((p) => !p.includes(' ')));
  assert.deepEqual(qualiCaption({ time: 95, timeSegment: 0, best: { time: 95, segment: 0 } }, ['Q1', 'Q2', 'Q3']), ['Q1\u00a01:35.000']);
});

test('flag band: yellows sent together are one moment; idle share is only what no running period covers', () => {
  const at = (s: number) => Date.parse('2026-10-11T12:00:00Z') + s * 1000;
  const moments = yellowMoments([
    { at: at(0), kind: 'yellow', sector: 3 }, { at: at(0), kind: 'yellow', sector: 4 }, { at: at(0.5), kind: 'double-yellow', sector: 4 },
    { at: at(90), kind: 'yellow', sector: 9 },
  ]);
  assert.deepEqual(moments.map((m) => [m.count, m.double]), [[3, true], [1, false]]);
  assert.equal(idleShare([{ from: at(0), to: at(100) }], at(0), at(100)), 0);
  assert.ok(Math.abs(idleShare([{ from: at(0), to: at(40) }, { from: at(60), to: at(100) }], at(0), at(100)) - 0.2) < 1e-9);
  assert.equal(idleShare([], at(0), at(100)), 1);
});

test('a coded position ("RT" in Singapore qualifying) is accepted, never printed as a place, and reads as a word', () => {
  const raw = { position: 'RT', driver_number: 6, number_of_laps: 3, dnf: false, dns: false, dsq: false, duration: [null, null, null], gap_to_leader: [null, null, null], meeting_key: 1296, session_key: 11384 };
  assert.equal(validResultRow(raw, 11384), true);
  assert.equal(validResultRow({ ...raw, position: 'retired, see notes' }, 11384), false);
  const row = normaliseResultRow(raw as unknown as SessionResultRow & { position: unknown });
  assert.equal(row.position, null);
  assert.equal(row.position_code, 'RT');
  const leader = { position: 1, driver_number: 3, number_of_laps: 15, dnf: false, dns: false, dsq: false, duration: [93.241, 91.639, 91.373], gap_to_leader: [0.812, 0.11, 0], session_key: 11384 } as SessionResultRow;
  const out = buildClassification('qualifying', [row, leader], new Map());
  assert.equal(out[0]!.number, 3);
  assert.equal(out[1]!.status, 'Retired');
  assert.equal(out[1]!.position, null);
});
