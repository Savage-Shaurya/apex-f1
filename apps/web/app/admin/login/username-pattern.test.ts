import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USERNAME_PATTERN } from './username-pattern';

// Browsers wrap a pattern as ^(?:pattern)$ and compile it with the v flag.
const asBrowser = (pattern: string) => new RegExp(`^(?:${pattern})$`, 'v');

test('admin username pattern compiles under the v flag browsers use', () => {
  assert.doesNotThrow(() => asBrowser(USERNAME_PATTERN));
});

test('admin username pattern matches the server rule', () => {
  const re = asBrowser(USERNAME_PATTERN);
  for (const ok of ['admin', 'a', 'shaurya.punj', 'ed-1', 'x_y']) assert.equal(re.test(ok), true, ok);
  for (const bad of ['Admin', '1admin', '-admin', 'ad min', 'ad/min', '']) assert.equal(re.test(bad), false, bad);
});
