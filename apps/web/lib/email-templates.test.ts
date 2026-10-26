import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRaceWeekBriefing } from './email-templates';

const standings = [{ position: 1, driverName: 'Lando Norris', teamName: 'McLaren', points: 390 }];

test('wave-1 leftover: the standings link uses the real season, or the archive, never the clock year', () => {
  const now = Date.parse('2027-01-03T09:00:00Z');
  const withSeason = renderRaceWeekBriefing({ next: null, articles: [], driverStandings: standings, siteUrl: 'https://apex-f1-five.vercel.app', standingsSeason: 2026, issuedAtMs: now });
  assert.match(withSeason.html, /\/results\/2026\/drivers/);
  assert.match(withSeason.html, /&copy; 2027 APEX/);
  const unknown = renderRaceWeekBriefing({ next: null, articles: [], driverStandings: standings, siteUrl: 'https://apex-f1-five.vercel.app', issuedAtMs: now });
  assert.match(unknown.html, /\/results\/archive"/);
  assert.doesNotMatch(unknown.html, /\/results\/2027\//);
});
