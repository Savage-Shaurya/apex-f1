import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialDirectoryQuery, slashShortcutFocuses } from './directory-keys';

const inDirectory = { enabled: true, withinDirectory: true };
const div = { tagName: 'DIV', isContentEditable: false };

test('"/" outside the directory never steals focus (R3-REG-5, R3-CLICK-5)', () => {
  assert.equal(slashShortcutFocuses({ key: '/', target: div }, { enabled: true, withinDirectory: false }), false);
});

test('"/" can be switched off (WCAG 2.1.4)', () => {
  assert.equal(slashShortcutFocuses({ key: '/', target: div }, { enabled: false, withinDirectory: true }), false);
});

test('"/" never hijacks typing or modified keys', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(slashShortcutFocuses({ key: '/', target: { tagName } }, inDirectory), false, tagName);
  assert.equal(slashShortcutFocuses({ key: '/', target: { tagName: 'DIV', isContentEditable: true } }, inDirectory), false);
  assert.equal(slashShortcutFocuses({ key: '/', metaKey: true, target: div }, inDirectory), false);
  assert.equal(slashShortcutFocuses({ key: '/', ctrlKey: true, target: div }, inDirectory), false);
});

test('"/" inside the directory, switched on, not typing: focuses the search', () => {
  assert.equal(slashShortcutFocuses({ key: '/', target: { tagName: 'A' } }, inDirectory), true);
  assert.equal(slashShortcutFocuses({ key: 'a', target: { tagName: 'A' } }, inDirectory), false);
});

test('a cleared search stays cleared after Back: no ?q= means an empty query (R3-CLICK-3)', () => {
  // Back replays the first visit's server render (query "senna") on a URL whose ?q= was cleared.
  assert.equal(initialDirectoryQuery(new URLSearchParams('letter=S'), 'senna'), '');
  assert.equal(initialDirectoryQuery(new URLSearchParams(''), 'senna'), '');
  assert.equal(initialDirectoryQuery(new URLSearchParams('q=prost'), 'senna'), 'prost');
});
