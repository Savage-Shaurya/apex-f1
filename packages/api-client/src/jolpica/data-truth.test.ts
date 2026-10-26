import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jolpica } from './client';
import { mapDriverStanding, mapResult } from './mappers';

const russell = { driverId: 'russell', givenName: 'George', familyName: 'Russell', code: 'RUS' };
const lawson = { driverId: 'lawson', givenName: 'Liam', familyName: 'Lawson', code: 'LAW' };
const circuit = { circuitId: 'americas', circuitName: 'Circuit of the Americas', Location: { lat: '30.1328', long: '-97.6411', locality: 'Austin', country: 'USA' } };
function envelope(table: Record<string, unknown>, total = 1) { return { MRData: { series: 'f1', limit: '100', offset: '0', total: String(total), ...table } }; }
const strict = (body: unknown) => ({ strict: true, fetchImpl: async () => Response.json(body), deadlineMs: 1000, timeoutMs: 1000 } as const);

test('D2-DATA-TRUTH-1: a classified retirement with an empty Time string falls back to its status', () => {
  const row = mapResult({ number: '63', position: '20', positionText: '20', points: '0', status: 'Retired', laps: '51', Driver: russell, Time: { time: '' } } as never);
  assert.equal(row.time, undefined);
  assert.equal(row.status, 'Retired');
  assert.equal(mapResult({ number: '4', position: '1', positionText: '1', points: '25', status: 'Finished', Driver: russell, Time: { millis: '5640000', time: '1:34:00.000' } } as never).time, '1:34:00.000');
});

test('D2-DATA-TRUTH-6: mid-season team changes keep every team, current team last', () => {
  const standing = mapDriverStanding({ position: '14', positionText: '14', points: '38', wins: '0', Driver: lawson, Constructors: [{ constructorId: 'red_bull', name: 'Red Bull' }, { constructorId: 'rb', name: 'RB F1 Team' }] } as never);
  assert.deepEqual(standing.constructors.map((team) => team.slug), ['red_bull', 'rb']);
  assert.equal(standing.constructorSlug, 'rb');
});

test('wave-1 leftover: qualifying and sprint rows without a car number ("None") are accepted', async () => {
  const qualifying = await jolpica.getQualifyingFull(2024, 19, strict(envelope({ RaceTable: { season: '2024', round: '19', Races: [{ season: '2024', round: '19', raceName: 'United States Grand Prix', date: '2024-10-20', Circuit: circuit, QualifyingResults: [{ number: 'None', position: '1', Driver: russell, Constructor: { constructorId: 'mercedes', name: 'Mercedes' }, Q1: '1:33.000' }] }] } })));
  assert.equal(qualifying.length, 1);
  assert.equal(qualifying[0]!.number, undefined);
  const sprint = await jolpica.getSprint(2024, 19, strict(envelope({ RaceTable: { season: '2024', round: '19', Races: [{ season: '2024', round: '19', raceName: 'United States Grand Prix', date: '2024-10-20', Circuit: circuit, SprintResults: [{ number: 'None', position: '1', positionText: '1', points: '8', Driver: russell, Constructor: { constructorId: 'mercedes', name: 'Mercedes' } }] }] } })));
  assert.equal(sprint.length, 1);
});

test('the schedule snapshot names the declared season even before any race is published', async () => {
  const empty = await jolpica.getScheduleSnapshot('current', strict(envelope({ RaceTable: { season: '2027', Races: [] } }, 0)));
  assert.deepEqual(empty, { season: 2027, races: [] });
});
