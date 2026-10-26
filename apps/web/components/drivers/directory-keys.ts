/**
 * Pure rules behind the directory's keyboard and URL behaviour, kept apart
 * from React so they can be tested directly.
 */

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/** True when the key press comes from a place where "/" is text, not a command. */
export function isTypingTarget(target: KeyLike['target']): boolean {
  return Boolean(target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? '') || target.isContentEditable));
}

/**
 * Whether "/" should move focus to the directory search (WCAG 2.1.4): only
 * while the shortcut is switched on, only for a key press inside the
 * directory, never while typing, never with a modifier.
 */
export function slashShortcutFocuses(e: KeyLike, opts: { enabled: boolean; withinDirectory: boolean }): boolean {
  if (!opts.enabled || !opts.withinDirectory) return false;
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return false;
  return !isTypingTarget(e.target);
}

/**
 * The query the directory starts from. Once the page has a URL, the address
 * bar is the truth: a missing ?q= means an empty search, even when an older
 * server render (replayed from the router cache on Back) carried one
 * (R3-CLICK-3).
 */
export function initialDirectoryQuery(params: { get(name: string): string | null }, serverQuery?: string): string {
  void serverQuery; // deliberately ignored: it can be stale (see above)
  return params.get('q') ?? '';
}
