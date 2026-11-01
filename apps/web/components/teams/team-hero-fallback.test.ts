import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Review 2026-11-01 (finding 6): a team hero whose Commons car photo fails shows the emblem, never nothing. */
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the team hero photo falls back to the TeamEmblem graphic when the photo fails', () => {
  const hero = src('./TeamHero.tsx');
  // The photo branch no longer renders a bare WireImage (which removes itself on error).
  assert.doesNotMatch(hero, /<WireImage\b/);
  assert.match(hero, /visual === 'photo' && photo && <TeamHeroPhoto /);
  const photo = src('./TeamHeroPhoto.tsx');
  assert.match(photo, /^'use client';/);
  assert.match(photo, /if \(failed\) return <TeamEmblem /);
  assert.match(photo, /<WireImage[^>]*onFail=\{fail\}/);
  // WireImage reports its failure to the caller.
  const wire = src('../news/WireImage.tsx');
  assert.match(wire, /onFail\?: \(\) => void;/);
  assert.match(wire, /setFailed\(true\);\s*onFail\?\.\(\);/);
  // The emblem is shared, so the no-photo and failed-photo heroes look the same.
  assert.match(src('./TeamEmblem.tsx'), /export function TeamEmblem\(/);
  assert.match(hero, /visual === 'emblem' && <TeamEmblem /);
});
