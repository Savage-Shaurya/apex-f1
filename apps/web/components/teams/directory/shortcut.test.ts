import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { directoryQuery, readShortcutPreference, shouldFocusSearch, writeShortcutPreference, SHORTCUT_STORAGE_KEY } from './shortcut';

const key = (over: Partial<Parameters<typeof shouldFocusSearch>[0]> = {}) => ({ key: '/', ctrlKey: false, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, ...over });
const on = (tagName: string, extra: Partial<{ isContentEditable: boolean; role: string | null; inDialog: boolean }> = {}) => ({ tagName, isContentEditable: false, role: null, inDialog: false, ...extra });

describe('directory "/" shortcut (WCAG 2.1.4)', () => {
  it('focuses the search from the page body when enabled', () => {
    assert.equal(shouldFocusSearch(key(), on('BODY'), true), true);
    assert.equal(shouldFocusSearch(key(), on('A'), true), true);
    assert.equal(shouldFocusSearch(key(), null, true), true);
  });
  it('can be turned off', () => {
    assert.equal(shouldFocusSearch(key(), on('BODY'), false), false);
  });
  it('never takes a keystroke meant for typing', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) assert.equal(shouldFocusSearch(key(), on(tag), true), false);
    assert.equal(shouldFocusSearch(key(), on('DIV', { isContentEditable: true }), true), false);
    assert.equal(shouldFocusSearch(key(), on('DIV', { role: 'textbox' }), true), false);
    assert.equal(shouldFocusSearch(key(), on('DIV', { role: 'combobox' }), true), false);
    assert.equal(shouldFocusSearch(key({ isComposing: true }), on('BODY'), true), false);
  });
  it('ignores modified keys, other keys, claimed keys and open dialogs', () => {
    assert.equal(shouldFocusSearch(key({ ctrlKey: true }), on('BODY'), true), false);
    assert.equal(shouldFocusSearch(key({ metaKey: true }), on('BODY'), true), false);
    assert.equal(shouldFocusSearch(key({ altKey: true }), on('BODY'), true), false);
    assert.equal(shouldFocusSearch(key({ key: 'k' }), on('BODY'), true), false);
    assert.equal(shouldFocusSearch(key({ defaultPrevented: true }), on('BODY'), true), false);
    assert.equal(shouldFocusSearch(key(), on('BUTTON', { inDialog: true }), true), false);
  });
  it('remembers the switch, and treats blocked storage as on', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    assert.equal(readShortcutPreference(storage), true);
    writeShortcutPreference(storage, false);
    assert.equal(store.get(SHORTCUT_STORAGE_KEY), 'off');
    assert.equal(readShortcutPreference(storage), false);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    assert.equal(readShortcutPreference(blocked), true);
    assert.doesNotThrow(() => writeShortcutPreference(blocked, false));
  });
});

describe('directory address bar (R3-CLICK-3)', () => {
  it('drops a cleared query instead of keeping it', () => {
    assert.equal(directoryQuery(new URLSearchParams('q=lotus&letter=L'), { q: '', letter: 'L' }), '?letter=L');
    assert.equal(directoryQuery(new URLSearchParams('q=lotus'), { q: '' }), '');
  });
  it('keeps unrelated parameters', () => {
    assert.equal(directoryQuery(new URLSearchParams('utm=x'), { q: 'ferrari' }), '?utm=x&q=ferrari');
  });
});
