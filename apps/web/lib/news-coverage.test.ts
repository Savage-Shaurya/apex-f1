import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newsCoverageDegraded } from './news-coverage';

const ok = (source: string, items = 10) => ({ source, ok: true, items });
const down = (source: string) => ({ source, ok: false, items: 0, error: 'rss: http (HTTP 403)', unavailable: true });

// 2026-10-31: one blocked feed (RaceFans answered 403 to the server) marked the whole news job degraded
// with 31 stories from 7 healthy sources, which turned the scheduled workflow red.
test('one failing source out of many, with plenty of stories, is a healthy news run', () => {
  const health = [ok('A'), ok('B'), ok('C'), ok('D'), ok('E'), ok('F'), ok('G'), down('H')];
  assert.equal(newsCoverageDegraded(health), false);
});

test('losing most sources is degraded; healthy empty feeds are not', () => {
  assert.equal(newsCoverageDegraded([ok('A'), down('B'), down('C'), down('D')]), true, 'under half the sources');
  assert.equal(newsCoverageDegraded([ok('A', 0), ok('B', 0), ok('C', 0), down('D')]), false, 'healthy empty feeds are not a failure');
  assert.equal(newsCoverageDegraded([]), true, 'no sources at all');
});
