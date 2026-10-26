import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { tokenizeArticleInline } from '../lib/article-inline';

function previous(text: string) {
  const expression = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  const tokens: ReturnType<typeof tokenizeArticleInline> = [];
  let cursor = 0;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    if (match.index > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, match.index) });
    tokens.push(match[1] && match[2] ? { kind: 'link', text: match[1], href: match[2], index: match.index }
      : { kind: match[3] || match[4] ? 'strong' : match[5] || match[6] ? 'em' : 'code', text: (match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7])!, index: match.index });
    cursor = expression.lastIndex;
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) });
  return tokens;
}
test('linear parser retains the current inline subset and leaves raw HTML as literal text', () => {
  for (const value of ['', 'Plain report', '**Bold** and __bold__ *em* _em_ `code`.', '[Race](https://fixture.invalid/a) [local](/schedule) [unsafe](javascript:alert)', '***a*** **a*b** __a_b__', '[nested[heading](url)', '[broken] (url) [ ]() [no](two words)', '<script>alert(1)</script>']) assert.deepEqual(tokenizeArticleInline(value), previous(value));
});
test('malformed maximum-size editorial text has bounded parsing time and keeps every character', () => {
  for (const value of ['['.repeat(100_000), `${'['.repeat(99_990)}](bad url)`, '`'.repeat(100_000), '_'.repeat(100_000)]) {
    const start = performance.now();
    const tokens = tokenizeArticleInline(value);
    assert(performance.now() - start < 1_000, 'A bounded article must not monopolize the server parser.');
    assert.deepEqual(tokens, [{ kind: 'text', text: value }]);
  }
});
test('deterministic short malformed combinations preserve previous greedy token behavior', () => {
  let seed = 139;
  const alphabet = '[ ]()*_`axy';
  for (let sample = 0; sample < 500; sample++) {
    let value = '';
    for (let index = 0; index < 80; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; value += alphabet[seed % alphabet.length]; }
    assert.deepEqual(tokenizeArticleInline(value), previous(value), value);
  }
});
