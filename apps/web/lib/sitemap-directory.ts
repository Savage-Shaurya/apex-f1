import { jolpica } from '@apex/api-client/jolpica';

type DirectoryProvider = Pick<typeof jolpica, 'getAllDrivers' | 'getAllConstructors' | 'getSchedule' | 'getSeasons' | 'getAllRaceWinners'>;

export class SitemapIncompleteError extends Error {
  constructor(readonly failed: string[]) {
    super(`sitemap directories unavailable: ${failed.join(', ')}`);
    this.name = 'SitemapIncompleteError';
  }
}

/**
 * The five Jolpica directories the sitemap is built from (D2-RESILIENCE-1):
 * drivers, constructors, the current calendar, seasons and the race history
 * (every classified race, ~1,100 race pages). The race history was once read
 * non-strictly, so an outage returned [] and a sitemap without any historical
 * race was cached for an hour (R3-REG-6 / R3-CODE-3); it is now fail-closed too.
 *
 * Reads are strict: an outage is an error, never an empty list. If any
 * directory cannot be read the whole sitemap render throws, so ISR keeps
 * serving the last complete sitemap instead of caching a 26-URL one for an
 * hour. During `next build` there is no earlier copy to keep, so the build
 * gets the partial result (regenerated on the first revalidation).
 */
export async function readSitemapDirectories(provider: DirectoryProvider = jolpica, options: { allowPartial?: boolean } = {}) {
  const opts = { revalidate: 86400, deadlineMs: 15_000, timeoutMs: 5_000, strict: true } as const;
  const [drivers, teams, calendar, seasons, history] = await Promise.allSettled([
    provider.getAllDrivers(opts),
    provider.getAllConstructors(opts),
    provider.getSchedule('current', opts),
    provider.getSeasons(opts),
    // One paginated read of every race winner; it needs a longer whole-operation budget.
    provider.getAllRaceWinners({ ...opts, deadlineMs: 30_000 }),
  ]);
  const failed = Object.entries({ drivers, teams, calendar, seasons, history }).filter(([, read]) => read.status === 'rejected').map(([name]) => name);
  const allowPartial = options.allowPartial ?? process.env.NEXT_PHASE === 'phase-production-build';
  if (failed.length && !allowPartial) throw new SitemapIncompleteError(failed);
  return { drivers, teams, calendar, seasons, history };
}
