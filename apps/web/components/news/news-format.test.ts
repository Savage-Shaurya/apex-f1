import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  citedSources,
  cleanHeadline,
  cleanSummary,
  dayHeading,
  groupByDay,
  groupByUtcDay,
  joinNames,
  paginate,
  parsePage,
  relativeAge,
  streamLayout,
  utcClock,
  utcDayKey,
  wordCount,
} from './news-format';

const NOW = Date.parse('2026-10-25T15:00:00Z');

test('cleanHeadline strips only the story\'s own publisher suffix', () => {
  assert.equal(cleanHeadline('Antonelli on pole in Austin | Motorsport.com', 'Motorsport.com'), 'Antonelli on pole in Austin');
  assert.equal(cleanHeadline('Verstapen wins &#8211; again - RaceFans', 'RaceFans'), 'Verstapen wins – again');
  // A suffix that is not the publisher is part of the headline.
  assert.equal(cleanHeadline('Hamilton: "I am not done" | Exclusive', 'Autosport'), 'Hamilton: "I am not done" | Exclusive');
  assert.equal(cleanHeadline('  Spaces   collapse  ', null), 'Spaces collapse');
  assert.equal(cleanHeadline('Antonelli pleased to avoid a breach | Formula 1', 'RaceFans'), 'Antonelli pleased to avoid a breach');
  assert.equal(cleanHeadline('Spotlight: Andretti recalls fistfight | Brief', 'RaceFans'), 'Spotlight: Andretti recalls fistfight | Brief');
});

test('cleanSummary removes tags and entities', () => {
  assert.equal(cleanSummary('<p>Red Bull&#39;s <b>upgrade</b></p>\n works'), "Red Bull's upgrade works");
});

test('utc formatting and relative ages are clock-pinned', () => {
  assert.equal(utcClock(Date.parse('2026-10-25T09:05:00Z')), '09:05 UTC');
  assert.equal(utcClock(0), '');
  assert.equal(relativeAge(NOW - 20_000, NOW, 'UTC'), 'just now');
  assert.equal(relativeAge(NOW + 120_000, NOW, 'UTC'), 'just now');
  assert.equal(relativeAge(NOW - 12 * 60_000, NOW, 'UTC'), '12 min ago');
  // Floored, and the same unit as the home ticker (R3-TIME-4): 2 h 50 min is "2 h ago".
  assert.equal(relativeAge(NOW - 170 * 60_000, NOW, 'UTC'), '2 h ago');
  assert.equal(relativeAge(NOW - 3 * 3_600_000, NOW, 'UTC'), '3 h ago');
  assert.equal(relativeAge(Date.parse('2026-10-24T08:00:00Z'), NOW, 'UTC'), 'yesterday');
  assert.equal(relativeAge(Date.parse('2026-10-21T08:00:00Z'), NOW, 'UTC'), '4 days ago');
  assert.equal(relativeAge(Date.parse('2026-10-01T08:00:00Z'), NOW, 'UTC'), '1 Oct');
});

test('day grouping keeps order and labels today and yesterday', () => {
  const items = [
    { t: Date.parse('2026-10-25T14:00:00Z') },
    { t: Date.parse('2026-10-25T01:00:00Z') },
    { t: Date.parse('2026-10-24T22:00:00Z') },
    { t: 0 },
  ];
  const groups = groupByUtcDay(items, (i) => i.t);
  assert.deepEqual(groups.map((g) => [g.key, g.items.length]), [['2026-10-25', 2], ['2026-10-24', 1], ['undated', 1]]);
  assert.equal(utcDayKey(items[0]!.t), '2026-10-25');
  assert.deepEqual(dayHeading('2026-10-25', NOW, 'UTC'), { relative: 'Today', date: 'Sunday 25 October' });
  assert.equal(dayHeading('2026-10-24', NOW, 'UTC').relative, 'Yesterday');
  assert.equal(dayHeading('2026-10-20', NOW, 'UTC').relative, null);
});

test('pagination clamps to real pages', () => {
  const list = Array.from({ length: 50 }, (_, i) => i);
  assert.deepEqual(paginate(list, 1, 24).slice.length, 24);
  assert.equal(paginate(list, 3, 24).slice.length, 2);
  assert.equal(paginate(list, 99, 24).page, 3);
  assert.equal(paginate([], 2, 24).totalPages, 1);
});

test('orphan control folds a short last page into the one before it', () => {
  // The real case from 25 Oct: 25 stories at 24 per page left one story on page 2.
  const list = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(paginate(list, 1, 24, 6), { page: 1, totalPages: 1, slice: list });
  assert.equal(paginate(list, 2, 24, 6).page, 1);
  // A last page of 6 or more stays its own page.
  const longer = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(paginate(longer, 1, 24, 6).totalPages, 2);
  assert.equal(paginate(longer, 2, 24, 6).slice.length, 6);
  // Three pages, short tail: page 2 carries the tail.
  const three = Array.from({ length: 50 }, (_, i) => i);
  const p2 = paginate(three, 2, 24, 6);
  assert.equal(p2.totalPages, 2);
  assert.equal(p2.slice.length, 26);
  assert.equal(paginate(three, 1, 24, 6).slice.length, 24);
});

test('page parsing', () => {
  assert.equal(parsePage('2'), 2);
  assert.equal(parsePage('-1'), 1);
  assert.equal(parsePage('abc'), 1);
  assert.equal(parsePage(undefined), 1);
});

test('stream rhythm: text rows for pictureless stories, a spread every fourth picture, alternating sides', () => {
  const layout = streamLayout([true, true, false, true, true, true, true, true, true]);
  assert.deepEqual(layout.map((l) => l.slot), ['spread', 'row', 'text', 'row', 'row', 'spread', 'row', 'row', 'row']);
  assert.equal(layout[0]!.flip, false);
  assert.equal(layout[5]!.flip, true);
});

test('joinNames and word counts', () => {
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
  assert.equal(wordCount('# Title\n\nAndrea Kimi Antonelli leads by **102** points. [Source](https://example.com)'), 9);
});

test('citedSources lists external links once, never images or credentials', () => {
  const md = '[FIA](https://www.fia.com/doc) and ![pic](https://img.example/x.jpg) and [FIA again](https://www.fia.com/doc) and [bad](https://u:p@evil.test/) [local](/drivers)';
  assert.deepEqual(citedSources(md), [{ href: 'https://www.fia.com/doc', label: 'FIA', host: 'fia.com' }]);
});

test('days and ages follow the viewer\'s own calendar (R3-TIME-3)', () => {
  // Sun 25 Oct 21:54 in Mexico City is already Monday 26 Oct in UTC.
  const now = Date.parse('2026-10-26T03:54:00Z');
  const tz = 'America/Mexico_City';
  assert.deepEqual(dayHeading('2026-10-25', now, tz), { relative: 'Today', date: 'Sunday 25 October' });
  assert.equal(dayHeading('2026-10-26', now, 'UTC').relative, 'Today');
  const items = [{ t: Date.parse('2026-10-26T02:00:00Z') }, { t: Date.parse('2026-10-25T20:00:00Z') }, { t: Date.parse('2026-10-25T04:00:00Z') }];
  assert.deepEqual(groupByDay(items, (i) => i.t, tz).map((g) => [g.key, g.items.length]), [['2026-10-25', 2], ['2026-10-24', 1]]);
  assert.deepEqual(groupByDay(items, (i) => i.t, 'UTC').map((g) => [g.key, g.items.length]), [['2026-10-26', 1], ['2026-10-25', 2]]);
  // Melbourne at local noon: a story from 01:00 local is "11 h ago" there, though it was yesterday in UTC.
  const mel = Date.parse('2026-10-26T01:00:00Z');
  assert.equal(relativeAge(Date.parse('2026-10-25T14:00:00Z'), mel, 'Australia/Melbourne'), '11 h ago');
  assert.equal(relativeAge(Date.parse('2026-10-25T14:00:00Z'), mel, 'UTC'), 'yesterday');
  // Across midnight but only an hour old: still read in hours.
  assert.equal(relativeAge(Date.parse('2026-10-25T23:30:00Z'), Date.parse('2026-10-26T00:45:00Z'), 'UTC'), '1 h ago');
});
