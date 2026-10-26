import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `.bc-mask` (brand-c.css, unlayered) sets its own negative margins to give
 * glyphs room inside the clip. Unlayered CSS beats Tailwind utilities, so a
 * margin utility on the same element is silently dropped (ProfileHero's
 * `bc-mask mt-1` put the surname straight under the first name). Spacing
 * belongs on a wrapper. Same rule as components/news/mask-spacing.test.ts.
 */
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOTS = ['app/drivers', 'components/drivers'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

export function deadMaskMargins(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([^)]*)\)\})/g)) {
    const cls = (m[1] ?? m[2] ?? m[3] ?? '').replace(/['",]/g, ' ').split(/\s+/);
    if (cls.includes('bc-mask') && cls.some((c) => /^-?m[tby]?-/.test(c.replace(/^[a-z0-9]+:/, '')))) hits.push(m[0]);
  }
  return hits;
}

test('the rule catches a margin utility on a .bc-mask element and ignores a wrapper', () => {
  assert.equal(deadMaskMargins('<span className="bc-mask mt-1" style={{}}>').length, 1);
  assert.equal(deadMaskMargins('<span className={cn("bc-mask", "lg:mb-2")}>').length, 1);
  assert.equal(deadMaskMargins('<span className="mt-1 block"><span className="bc-mask">').length, 0);
  assert.equal(deadMaskMargins('<span className="bc-mask px-2">').length, 0);
});

test('the drivers area never puts a margin utility on a .bc-mask element', () => {
  const hits = ROOTS.flatMap((r) => files(path.join(WEB, r)).flatMap((f) => deadMaskMargins(readFileSync(f, 'utf8')).map((h) => `${path.relative(WEB, f)}: ${h}`)));
  assert.deepEqual(hits, []);
});
