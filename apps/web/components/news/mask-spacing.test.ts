import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `.bc-mask` (brand-c.css, unlayered) sets its own negative margins to give
 * glyphs room inside the clip. Unlayered CSS beats Tailwind utilities, so a
 * margin utility on the same element is silently dropped: on /newsletter the
 * `mt-5` vanished and the kicker sat on the title. Spacing belongs on a wrapper.
 */
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOTS = ['app/latest', 'app/video', 'app/search', 'app/newsletter', 'app/article', 'components/news', 'components/video', 'components/search', 'components/newsletter'];

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
  assert.equal(deadMaskMargins('<h1 className="bc-display bc-mask mt-5 text-4xl">').length, 1);
  assert.equal(deadMaskMargins('<span className={cn("bc-mask", "lg:mb-2")}>').length, 1);
  assert.equal(deadMaskMargins('<div className="mt-5"><h1 className="bc-display bc-mask">').length, 0);
  assert.equal(deadMaskMargins('<span className="bc-mask px-2 gap-x-3">').length, 0);
});

test('news, video, search, newsletter and article never put a margin utility on a .bc-mask element', () => {
  const hits = ROOTS.flatMap((r) => files(path.join(WEB, r)).flatMap((f) => deadMaskMargins(readFileSync(f, 'utf8')).map((h) => `${path.relative(WEB, f)}: ${h}`)));
  assert.deepEqual(hits, []);
});
