import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// Resolve the consumers' installed dependencies, not a detached test copy.
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const typography = createRequire(web.resolve('@tailwindcss/typography'));
const postcss = createRequire(web.resolve('postcss'));
const worker = createRequire(new URL('../apps/workers/package.json', import.meta.url));
const drizzle = createRequire(worker.resolve('drizzle-orm'));
const gel = createRequire(drizzle.resolve('gel'));

test('installed source-map reader rejects amplifying and invalid offsets while retaining ordinary maps', () => {
  const { SourceMapConsumer, SourceMapGenerator, SourceNode } = postcss('source-map-js');
  const simple = { version: 3, sources: ['input.js'], names: [], mappings: 'AAAA', sourcesContent: ['x'] };
  const indexed = line => ({ version: 3, sections: [{ offset: { line, column: 0 }, map: simple }] });
  for (const line of [-1, NaN, Infinity, 0.5, '0', 10_000_001, 1e9]) {
    assert.throws(() => new SourceMapConsumer(indexed(line)), /offset/i);
  }
  assert.throws(() => new SourceMapConsumer({ version: 3, sections: [{ offset: { line: 6_000_000, column: 0 }, map: indexed(6_000_000) }] }), /offset/i);
  const consumer = new SourceMapConsumer(indexed(2));
  const mappings = [];
  consumer.eachMapping(mapping => mappings.push(mapping));
  assert.equal(mappings[0].source, 'input.js');
  assert.equal(mappings[0].generatedLine, 3);
  const regenerated = SourceMapGenerator.fromSourceMap(new SourceMapConsumer(simple));
  assert.equal(new SourceMapConsumer(regenerated.toString()).originalPositionFor({ line: 1, column: 0 }).source, 'input.js');
  assert.equal(SourceNode.fromStringWithSourceMap('\n\nx', consumer).toString(), '\n\nx');
});

test('installed shell quoting rejects every line terminator after a comment without executing a shell', () => {
  const shell = gel('shell-quote');
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    assert.throws(() => shell.quote(['echo', 'ok', { comment: 'x' }, `a${terminator}id;#`]), TypeError);
  }
  for (const tokens of [['echo', 'normal value'], ['tool', 'C:\\Program Files\\Apex'], ['tool', 'name; inert $(text)']]) {
    assert.deepEqual(shell.parse(shell.quote(tokens)), tokens);
  }
  assert.deepEqual(shell.parse(shell.quote(['echo', 'ok', { comment: 'ordinary' }])), ['echo', 'ok', { comment: 'ordinary' }]);
});

test('installed typography selector parser handles a large flat selector without quadratic blocking', () => {
  const parser = typography('postcss-selector-parser');
  const selector = '.a'.repeat(100_000);
  const started = performance.now();
  assert.equal(parser().processSync(selector), selector);
  assert.ok(performance.now() - started < 3_000, 'The patched 200 KB flat selector must complete within the generous regression budget.');
  const { commonTrailingPseudos } = typography('./utils.js');
  assert.deepEqual(commonTrailingPseudos('ol > li::marker, ul > li::marker'), ['::marker', 'ol > li, ul > li']);
});
