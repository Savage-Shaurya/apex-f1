import { revalidateTag } from 'next/cache';

/**
 * Mark a cache tag stale without throwing its last good copy away (R3-BE-4).
 *
 * `{ expire: 0 }` expires a tag immediately, so the next render must refetch
 * synchronously and a source that fails at that moment leaves pages without
 * it. The 'max' profile is stale-while-revalidate: pages keep serving the
 * previous entry while Next refetches in the background, and a failed
 * background refetch keeps the stale entry. Cron jobs call this only after
 * their own reads succeeded, so a failing run does not even mark it stale.
 */
export const KEEP_LAST_GOOD_PROFILE = 'max';

export function refreshTagKeepingLastGood(tag: string, revalidate: (tag: string, profile: string) => void = revalidateTag): void {
  revalidate(tag, KEEP_LAST_GOOD_PROFILE);
}

/**
 * Read first, then refresh: the tag is marked stale (never hard-expired) only
 * after `read` succeeded, so a failing source keeps its last good copy. The
 * read's error propagates unchanged.
 */
export async function readThenRefresh<T>(tag: string, read: () => Promise<T>, revalidate: (tag: string, profile: string) => void = revalidateTag): Promise<T> {
  const value = await read();
  refreshTagKeepingLastGood(tag, revalidate);
  return value;
}
