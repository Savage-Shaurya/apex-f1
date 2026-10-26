/**
 * The directory's "/" shortcut (WCAG 2.1.4, R3-REG-5 / R3-CLICK-5).
 *
 * It may move focus to the search field only when:
 *  - the reader has not turned it off (a visible switch, remembered per browser),
 *  - the key is a bare "/" (no Ctrl, Cmd, Alt; Shift is allowed so layouts that
 *    type "/" with Shift still work) and not part of an IME composition,
 *  - nothing editable has focus (input, textarea, select, contenteditable,
 *    role=textbox/combobox/searchbox) and no dialog is open, so it never
 *    takes a keystroke someone meant to type,
 *  - no other handler already claimed the key.
 */
export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
}
export interface ShortcutFocus {
  tagName: string;
  isContentEditable: boolean;
  role: string | null;
  inDialog: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const EDITABLE_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

export function shouldFocusSearch(e: ShortcutKey, focus: ShortcutFocus | null, enabled: boolean): boolean {
  if (!enabled) return false;
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented) return false;
  if (!focus) return true;
  if (focus.inDialog) return false;
  if (EDITABLE_TAGS.has(focus.tagName.toUpperCase()) || focus.isContentEditable) return false;
  if (focus.role && EDITABLE_ROLES.has(focus.role)) return false;
  return true;
}

export const SHORTCUT_STORAGE_KEY = 'apex:directory-slash';

/** Stored preference: on unless the reader turned it off. Storage can be blocked: then it is simply on. */
export function readShortcutPreference(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SHORTCUT_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function writeShortcutPreference(storage: Pick<Storage, 'setItem'> | null, on: boolean): void {
  try {
    storage?.setItem(SHORTCUT_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* blocked storage: the switch still works for this visit */
  }
}

/**
 * The directory state written to the address bar. Empty values are removed,
 * every other parameter is kept. Returns "" or "?…". A cleared search leaves
 * no ?q= behind, so Back never brings it back (R3-CLICK-3).
 */
export function directoryQuery(current: URLSearchParams, state: Record<string, string>): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(state)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const text = next.toString();
  return text ? `?${text}` : '';
}
