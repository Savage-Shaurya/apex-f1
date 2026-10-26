/**
 * History entry for the open video player, so the browser's Back button
 * closes the player and stays on the page instead of leaving the page with
 * the video still playing (audit D2-CLICK-PATHS-2).
 *
 * Opening the player pushes one same-URL entry marked with the video id;
 * Back pops it and the player closes. Closing with the button or Escape pops
 * that entry too, so history never fills with dead player entries; Forward
 * onto that entry later reopens the same video, so it is never a dead step.
 */
export const VIDEO_HISTORY_KEY = '__apexVideo';

export interface VideoEntry { id: string; title: string; channel: string; poster: string }

/**
 * State for the player entry: Next fills in its own router fields when the
 * entry is pushed. The title, channel and poster ride along so Forward onto
 * the entry after a close can reopen the same video (R3-CLICK-4).
 */
export function videoEntryState(id: string, meta: Partial<Omit<VideoEntry, 'id'>> = {}): Record<string, string> {
  return { [VIDEO_HISTORY_KEY]: id, __apexVideoTitle: meta.title ?? '', __apexVideoChannel: meta.channel ?? '', __apexVideoPoster: meta.poster ?? '' };
}

/** The video a history entry belongs to, or null for any other entry. */
export function videoEntryOf(state: unknown): VideoEntry | null {
  if (typeof state !== 'object' || state === null) return null;
  const s = state as Record<string, unknown>;
  const id = s[VIDEO_HISTORY_KEY];
  if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return { id, title: str(s.__apexVideoTitle), channel: str(s.__apexVideoChannel), poster: str(s.__apexVideoPoster) };
}

/** Whether `state` is the player entry for `id` (the entry this player pushed). */
export function isVideoEntry(state: unknown, id: string): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[VIDEO_HISTORY_KEY] === id;
}

/**
 * Whether the player must close because the page under it changed: a route
 * change (Back or Forward to another page) must never leave a video playing
 * over the wrong page with scrolling locked.
 */
export function playerOutlivedPage(openedOn: string | null, pathname: string | null): boolean {
  return openedOn !== null && pathname !== null && openedOn !== pathname;
}
