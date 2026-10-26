import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VIDEO_HISTORY_KEY, isVideoEntry, playerOutlivedPage, videoEntryOf, videoEntryState } from './video-history';

test('the player history entry is recognised only for its own video (D2-CLICK-PATHS-2)', () => {
  const state = videoEntryState('abcdefghijk');
  assert.equal(state[VIDEO_HISTORY_KEY], 'abcdefghijk');
  assert.equal(isVideoEntry(state, 'abcdefghijk'), true);
  // Next adds its own router fields to the pushed entry; the marker survives them.
  assert.equal(isVideoEntry({ ...state, __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: [] }, 'abcdefghijk'), true);
  // After Back, the page's own entry is current: the player must close.
  assert.equal(isVideoEntry({ __NA: true }, 'abcdefghijk'), false);
  assert.equal(isVideoEntry(null, 'abcdefghijk'), false);
  assert.equal(isVideoEntry(videoEntryState('zzzzzzzzzzz'), 'abcdefghijk'), false);
});

test('a route change under the player closes it', () => {
  assert.equal(playerOutlivedPage('/video', '/drivers'), true);
  assert.equal(playerOutlivedPage('/video', '/video'), false);
  assert.equal(playerOutlivedPage(null, '/video'), false);
  assert.equal(playerOutlivedPage('/video', null), false);
});

test("a closed player's history entry is recognised, so Back/Forward can step over it instead of reopening", () => {
  const state = { ...videoEntryState('abcdefghijk', { title: 'Race Highlights', channel: 'FORMULA 1', poster: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }), __NA: true };
  assert.deepEqual(videoEntryOf(state), { id: 'abcdefghijk', title: 'Race Highlights', channel: 'FORMULA 1', poster: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' });
  assert.equal(videoEntryOf({ __NA: true }), null);
  assert.equal(videoEntryOf({ [VIDEO_HISTORY_KEY]: 'bad id' }), null);
  assert.equal(videoEntryOf(null), null);
});
