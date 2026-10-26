import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapRace, type JolpicaRace } from '@apex/api-client/jolpica';
import type { OpenF1Session } from '@apex/api-client/openf1';
import { initialSessionState, nextTimedSession, preciseSessionTimestamp } from './session-calendar';

test('date-only calendar records never establish a precise start or midnight countdown', () => {
  assert.equal(preciseSessionTimestamp('2026-03-01'), null);
  assert.equal(preciseSessionTimestamp('not a time'), null);
  assert.equal(preciseSessionTimestamp('2026-02-30T14:30:00Z'), null);
  assert.equal(preciseSessionTimestamp('2026-03-01T24:30:00Z'), null);
  assert.equal(preciseSessionTimestamp('2026-03-01T14:30:00Z'), Date.parse('2026-03-01T14:30:00Z'));
});

test('older sprint-format next session follows timestamps, not mapper insertion order', () => {
  const raw: JolpicaRace = { season: '2021', round: '10', raceName: 'Fixture Grand Prix', date: '2021-07-18', time: '14:00:00Z', url: '', Circuit: { circuitId: 'fixture', circuitName: 'Fixture', url: '', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } }, FirstPractice: { date: '2021-07-16', time: '13:00:00Z' }, SecondPractice: { date: '2021-07-17', time: '11:00:00Z' }, Sprint: { date: '2021-07-17', time: '15:30:00Z' }, Qualifying: { date: '2021-07-16', time: '17:00:00Z' } };
  const next = nextTimedSession([mapRace(raw)], Date.parse('2021-07-16T14:00:00Z'));
  assert.equal(next?.session.kind, 'Q'); assert.equal(next?.session.iso, '2021-07-16T17:00:00Z');
});

test('next start is selected across races and skips date-only or passed starts', () => {
  const race = mapRace({ season: '2026', round: '1', raceName: 'Fixture', date: '2026-03-01', url: '', Circuit: { circuitId: 'fixture', circuitName: 'Fixture', url: '', Location: { lat: '1', long: '2', country: 'Fixture', locality: 'Fixture' } } });
  assert.equal(nextTimedSession([race], Date.parse('2026-02-01T00:00:00Z')), null);
  const later = { ...race, round: 2, sessions: [{ kind: 'R', iso: '2026-03-20T14:00:00Z' }] };
  const sooner = { ...race, round: 3, sessions: [{ kind: 'Q', iso: '2026-03-19T12:00:00Z' }] };
  assert.equal(nextTimedSession([later, sooner], Date.parse('2026-03-01T00:00:00Z'))?.race.round, 3);
});

test('confirmed cancelled sessions cannot be classified as live within the original window', () => {
  const session = { session_key: 1, location: 'Fixture', session_name: 'Race', date_start: '2026-03-01T14:00:00Z', date_end: '2026-03-01T16:00:00Z', is_cancelled: true } as OpenF1Session;
  const result = initialSessionState(session, Date.parse('2026-03-01T15:00:00Z'));
  assert.equal(result.state, 'completed'); assert.match(result.detail ?? '', /cancelled/);
  assert.equal(initialSessionState({ ...session, is_cancelled: false }, Date.parse('2026-03-01T15:00:00Z')).state, 'live');
  assert.equal(initialSessionState({ ...session, is_cancelled: false }, Date.parse('2026-03-01T13:00:00Z')).state, 'upcoming');
});
