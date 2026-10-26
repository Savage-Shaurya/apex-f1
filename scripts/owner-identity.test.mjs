import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The owner asked for their GitHub account and retired contact details never to
// appear anywhere in the public repository (not only in rendered pages).
// The quality gate's own block list is the one place allowed to spell them out.
const FORBIDDEN = /github\.com\/(ShAuRyA-Noodle|Savage-Shaurya)|workwithshaurya10|shaurya-punj-2287513b3|ShAuRyANoodle/i;
const ALLOWED = [/^apps\/web\/tests\/quality-gate\//, /^docs\/QUALITY-GATE\.md$/, /^scripts\/owner-identity\.test\.mjs$/];

test('no tracked file links the owner GitHub account or retired contact details', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const offenders = [];
  for (const file of files) {
    if (ALLOWED.some((rule) => rule.test(file))) continue;
    let text;
    try {
      text = readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (FORBIDDEN.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
