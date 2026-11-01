/**
 * Display enrichment with a budget: the read's value if it answers within `ms`,
 * otherwise (slow, failed or hung) the fallback. The read itself keeps running
 * and fills its own caches; the page just does not wait for it. Use only for
 * decoration (photos, colours), never for the data a page is about.
 */
export async function settleWithin<T>(read: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read.catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
