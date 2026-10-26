import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failureReason, readFailure, runningSession, type SessionLike } from './sheet-model';
import { HistoryUnavailable } from './openf1-history';

class ProviderError extends Error {
  constructor(readonly provider: string, readonly code: string, readonly status?: number) {
    super(`${provider}: ${code}`);
    this.name = 'ProviderError';
  }
}

test('OpenF1 live-session lockout (HTTP 401 without a token) reads as locked, not as an outage', () => {
  assert.equal(readFailure(new ProviderError('openf1', 'http', 401)), 'locked');
  assert.equal(readFailure(new HistoryUnavailable('locked')), 'locked');
});

test('a 401 with an access token configured is not mistaken for the lockout', () => {
  assert.equal(readFailure(new ProviderError('openf1', 'http', 401), true), 'network');
});

test('validation failures and other errors keep their own causes', () => {
  assert.equal(readFailure(new ProviderError('openf1', 'invalid-response')), 'invalid');
  assert.equal(readFailure(new HistoryUnavailable('invalid')), 'invalid');
  assert.equal(readFailure(new ProviderError('openf1', 'http', 503)), 'network');
  assert.equal(readFailure(new ProviderError('openf1', 'timeout')), 'network');
  assert.equal(readFailure(new HistoryUnavailable('network')), 'network');
  assert.equal(readFailure(null), 'network');
  assert.equal(readFailure('boom'), 'network');
});

const s = (name: string, start: string, end: string, extra: Partial<SessionLike> = {}): SessionLike =>
  ({ session_key: Math.floor(Date.parse(start) / 1000), session_name: name, session_type: name, date_start: start, date_end: end, ...extra }) as SessionLike;

test('runningSession names the session on track by its timetable and skips testing and cancelled', () => {
  const sessions = [
    s('Qualifying', '2026-10-24T21:00:00Z', '2026-10-24T22:00:00Z'),
    s('Race', '2026-10-25T20:00:00Z', '2026-10-25T22:00:00Z'),
    s('Day 1', '2026-10-25T19:00:00Z', '2026-10-25T23:00:00Z'),
  ];
  assert.equal(runningSession(sessions, Date.parse('2026-10-25T21:00:00Z'))?.session_name, 'Race');
  assert.equal(runningSession(sessions, Date.parse('2026-10-25T22:30:00Z')), null);
  assert.equal(runningSession([s('Race', '2026-10-25T20:00:00Z', '2026-10-25T22:00:00Z', { is_cancelled: true })], Date.parse('2026-10-25T21:00:00Z')), null);
});

test('lockout copy says when it ends and never asks the reader to retry', () => {
  const locked = failureReason('locked', 'the lap trace');
  assert.match(locked, /session is running/);
  assert.match(locked, /The lap trace comes back here after the session/);
  assert.doesNotMatch(locked, /try again|few minutes|shortly/i);
  assert.match(failureReason('network', 'the lap trace'), /The lap trace could not be loaded just now/);
  assert.match(failureReason('invalid', 'the lap trace'), /could not be confirmed/);
  for (const c of ['locked', 'invalid', 'network'] as const) assert.doesNotMatch(failureReason(c, 'the lap trace'), /OpenF1|free data|checks/);
});
