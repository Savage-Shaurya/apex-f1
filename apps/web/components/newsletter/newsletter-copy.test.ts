import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailProblem, nextBriefing, nextFridaySlot, submissionMessage } from './newsletter-copy';

test('email check says what to fix', () => {
  assert.equal(emailProblem(''), 'Enter your email address.');
  assert.match(emailProblem('name@') ?? '', /full email address/);
  assert.equal(emailProblem('  fan@example.com '), null);
});

test('only an accepted reply is called a subscription; unconfirmed stays unconfirmed', () => {
  assert.equal(submissionMessage({ kind: 'accepted', duplicate: false, welcomeStatus: 'sent' }).kind, 'success');
  assert.match(submissionMessage({ kind: 'accepted', duplicate: true, welcomeStatus: 'unavailable' }).text, /already subscribed/);
  assert.match(submissionMessage({ kind: 'accepted', duplicate: false, welcomeStatus: 'failed' }).text, /subscription is saved/);
  const uncertain = submissionMessage({ kind: 'uncertain', reason: 'timeout' });
  assert.equal(uncertain.kind, 'uncertain');
  assert.doesNotMatch(uncertain.text, /^Subscribed/);
  assert.equal(submissionMessage({ kind: 'rejected', status: 429 }).kind, 'error');
  assert.equal(submissionMessage({ kind: 'cancelled' }).kind, 'none');
});

test('briefing slots follow the Friday 06:00 UTC job and its 8-day race window', () => {
  // Sunday 25 Oct 2026 15:00 UTC -> Friday 30 Oct 06:00 UTC.
  const sunday = Date.parse('2026-10-25T15:00:00Z');
  assert.equal(new Date(nextFridaySlot(sunday)).toISOString(), '2026-10-30T06:00:00.000Z');
  // Friday before 06:00 -> the same morning; after -> next week.
  assert.equal(new Date(nextFridaySlot(Date.parse('2026-10-30T05:00:00Z'))).toISOString(), '2026-10-30T06:00:00.000Z');
  assert.equal(new Date(nextFridaySlot(Date.parse('2026-10-30T07:00:00Z'))).toISOString(), '2026-11-06T06:00:00.000Z');

  const races = [
    { name: 'United States', raceStartIso: '2026-10-25T20:00:00Z' },
    { name: 'Mexico City', raceStartIso: '2026-11-01T20:00:00Z' },
    { name: 'Sao Paulo', raceStartIso: '2026-11-08T17:00:00Z' },
    { name: 'Las Vegas', raceStartIso: '2026-11-22T06:00:00Z' },
  ];
  const next = nextBriefing(sunday, races);
  assert.equal(next?.race.name, 'Mexico City');
  // A gap week: from the Sao Paulo weekend, the next covered Friday is the Las Vegas one.
  const gap = nextBriefing(Date.parse('2026-11-08T18:00:00Z'), races);
  assert.equal(gap?.race.name, 'Las Vegas');
  assert.equal(new Date(gap!.sendAt).toISOString(), '2026-11-20T06:00:00.000Z');
  assert.equal(nextBriefing(Date.parse('2026-12-31T00:00:00Z'), races), null);
});
