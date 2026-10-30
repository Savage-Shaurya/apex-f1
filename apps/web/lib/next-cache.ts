import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * Next's cache invalidation, behind one object so the cron outage matrix
 * (tests/cron-outage-matrix.test.ts) can run the real route handlers outside a
 * Next request, where these calls throw "static generation store missing".
 * Production code calls through it unchanged.
 */
export const nextCache = {
  revalidateTag: (tag: string, profile: Parameters<typeof revalidateTag>[1]) => revalidateTag(tag, profile),
  revalidatePath: (path: string) => revalidatePath(path),
};
