import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REFERENCE_GROUPS } from './credits';

// R3-CLICK-6: a credit listed more than once rendered duplicate React keys and repeated rows.
// /references keys rows by name and link, so every credit must appear exactly once across the page.
test('every credit on /references appears exactly once', () => {
  const seen = new Map<string, string>();
  for (const group of REFERENCE_GROUPS) {
    for (const c of group.credits) {
      const key = `${c.name}|${c.href}`;
      assert.equal(seen.has(key), false, `${c.name} is listed in both "${seen.get(key)}" and "${group.title}"`);
      seen.set(key, group.title);
    }
  }
  assert.ok(seen.size > 10);
});
