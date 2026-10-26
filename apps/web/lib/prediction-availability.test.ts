import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPredictionAvailability } from './prediction-availability';

const now = Date.parse('2026-10-03T10:00:00Z');
const future = now + 10 * 60 * 60 * 1000;

test('an unavailable service with ten hours until qualifying disables picks without claiming they locked', () => {
  const state = getPredictionAvailability({ available: false, lockTimestamp: future, now });
  assert.equal(state.kind, 'unavailable');
  assert.equal(state.disabled, true);
  assert.equal(state.label, 'PREDICTIONS UNAVAILABLE');
  assert.doesNotMatch(state.message, /qualifying has started|locked|after qualifying/i);
  assert.match(state.message, /temporarily unavailable/);
  assert.equal(getPredictionAvailability({ available: true, lockTimestamp: future, now }).disabled, false);
});

test('with no database connected the message says picks cannot be saved yet, without internals', () => {
  const state = getPredictionAvailability({ available: false, lockTimestamp: future, now, reason: 'database' });
  assert.equal(state.kind, 'unavailable');
  assert.match(state.message, /can’t be saved just yet/);
  assert.doesNotMatch(state.message, /database/i);
  assert.doesNotMatch(state.message, /locked|qualifying has started/i);
});

test('the actual deadline locks at its boundary even when service availability is false', () => {
  for (const available of [true, false]) {
    assert.equal(getPredictionAvailability({ available, lockTimestamp: future, now: future - 1 }).kind,
      available ? 'open' : 'unavailable');
    for (const checkedAt of [future, future + 1]) {
      const state = getPredictionAvailability({ available, lockTimestamp: future, now: checkedAt });
      assert.equal(state.kind, 'locked');
      assert.equal(state.disabled, true);
      assert.equal(state.label, 'PICKS LOCKED');
      assert.match(state.message, /Qualifying has started/);
    }
  }
});

test('missing, invalid and nonpositive deadlines stay unavailable without implying qualifying started', () => {
  for (const lockTimestamp of [undefined, NaN, Infinity, -Infinity, 0, -1]) {
    for (const available of [true, false]) {
      const state = getPredictionAvailability({ available, lockTimestamp, now });
      assert.equal(state.kind, 'unavailable');
      assert.equal(state.disabled, true);
      assert.match(state.message, /deadline is not available yet/);
      assert.doesNotMatch(state.message, /qualifying has started|locked/i);
    }
  }
});

test('a confirmed server lock still disables a future-deadline form without asserting the deadline elapsed', () => {
  const state = getPredictionAvailability({ available: true, lockTimestamp: future, now, serverLocked: true });
  assert.equal(state.kind, 'locked');
  assert.equal(state.disabled, true);
  assert.equal(state.message, 'Picks are locked for this race.');
});
