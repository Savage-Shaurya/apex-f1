import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorialArticle, EditorialInput } from '@apex/db';
import { captureEditorialAttempt, classifyEditorialRecovery } from '../lib/article-recovery';

const id = '10000000-0000-4000-8000-000000000001';
const baseRevision = '2026-10-03 12:13:14.123456+00';
const nextRevision = '2026-10-03 12:13:14.123457+00';
const desired: EditorialInput = { title: 'Attempted title', slug: 'race-report', dek: null, section: null, bodyMd: 'My attempted reporting.\n\nKeep this text.', status: 'published' };
const prior: EditorialArticle = { ...desired, id, title: 'Prior stored title', bodyMd: 'The old report.', revision: baseRevision, status: 'draft', visibility: 'draft', editable: true, publishedAt: null };
const committed: EditorialArticle = { ...prior, ...desired, revision: nextRevision, visibility: 'public', publishedAt: '2026-10-03 12:13:14.123457+00' };

test('ambiguous PATCH that did not commit never confirms or replaces the attempted snapshot', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, desired);
  const outcome = classifyEditorialRecovery(attempt, prior);
  assert.equal(outcome.kind, 'not-confirmed');
  if (outcome.kind === 'not-confirmed') assert.equal(outcome.reason, 'unchanged');
  assert.equal(attempt.input.bodyMd, desired.bodyMd); assert.equal(attempt.input.title, desired.title); assert.equal(attempt.baseRevision, baseRevision);
});
test('ambiguous PATCH confirms only matching controlled content and an advanced revision', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, desired);
  assert.equal(classifyEditorialRecovery(attempt, committed).kind, 'confirmed');
  assert.equal(classifyEditorialRecovery(attempt, { ...committed, revision: baseRevision }).kind, 'not-confirmed');
  assert.equal(classifyEditorialRecovery(attempt, { ...committed, revision: '2026-10-03 12:13:14.123455+00' }).kind, 'conflict');
});
test('ambiguous PATCH with a concurrent writer preserves attempted text and exposes a conflict', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, desired);
  const otherWriter = { ...committed, title: 'Another editor changed this', bodyMd: 'Other reporting.' };
  const outcome = classifyEditorialRecovery(attempt, otherWriter);
  assert.equal(outcome.kind, 'conflict');
  assert.equal(attempt.input.bodyMd, desired.bodyMd);
  assert.equal(outcome.article?.bodyMd, 'Other reporting.');
});
test('recovery checks publication transitions, URL, identity and every editable content field', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, desired);
  for (const change of [{ id: '20000000-0000-4000-8000-000000000001' }, { slug: 'other-report' }, { title: 'Other title' }, { dek: 'Different summary' }, { section: 'NEWS' }, { bodyMd: 'Other body' }, { status: 'draft' as const }]) {
    assert.equal(classifyEditorialRecovery(attempt, { ...committed, ...change }).kind, 'conflict');
  }
  assert.equal(classifyEditorialRecovery(attempt, null).kind, 'conflict');
});
test('ambiguous creation confirms its stable UUID only when desired content matches', () => {
  const attempt = captureEditorialAttempt(id, null, desired);
  assert.equal(classifyEditorialRecovery(attempt, committed).kind, 'confirmed');
  assert.equal(classifyEditorialRecovery(attempt, { ...committed, bodyMd: 'Other content' }).kind, 'conflict');
  const absent = classifyEditorialRecovery(attempt, null);
  assert.equal(absent.kind, 'not-confirmed');
  if (absent.kind === 'not-confirmed') assert.equal(absent.reason, 'missing');
  assert.equal(attempt.id, id); assert.equal(attempt.input.bodyMd, desired.bodyMd);
});
test('attempt normalization mirrors API trimming without changing null optional fields', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, { ...desired, title: ' Attempted title ', slug: ' race-report ', bodyMd: `  ${desired.bodyMd}  `, dek: '  ', section: '' });
  assert.deepEqual(attempt.input, desired);
  assert.equal(classifyEditorialRecovery(attempt, committed).kind, 'confirmed');
});
test('recovery revision comparison retains microseconds and recognizes equivalent timezone tokens', () => {
  const attempt = captureEditorialAttempt(id, baseRevision, desired);
  const sameInstantDifferentZone = { ...committed, revision: '2026-10-03 17:43:14.123456+05:30' };
  assert.equal(classifyEditorialRecovery(attempt, sameInstantDifferentZone).kind, 'not-confirmed');
  assert.equal(classifyEditorialRecovery(attempt, { ...committed, revision: '2026-10-03T12:13:14.123457Z' }).kind, 'confirmed');
  assert.equal(classifyEditorialRecovery(attempt, { ...committed, revision: 'invalid' }).kind, 'conflict');
});
