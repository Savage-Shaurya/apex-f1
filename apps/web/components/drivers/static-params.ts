import { jolpica } from '@apex/api-client/jolpica';
import { prebuildable, readCurrentStandings, readDriverIdentity, retryUnavailable, type RetryOptions } from '@/lib/public-sport';

type StandingsRead = () => Promise<{ state: 'available' | 'unavailable'; snapshot: { standings: ReadonlyArray<{ Driver: { driverId: string } }> } | null }>;

const validSlug = /^[a-zA-Z0-9_-]{1,160}$/;

/**
 * Prebuilt paths for /drivers/[slug] and /drivers/[slug]/career: every driver
 * in the current standings (the previous season's final table between
 * seasons). A prebuilt page always has a good cached copy, so when a later
 * revalidation meets a provider outage the [slug] layout throws and Next keeps
 * serving that copy (ISR stale-on-error). Other drivers render on first visit.
 * A build-time outage (after a bounded retry) prebuilds nothing rather than failing the build.
 */
const currentStandings: StandingsRead = () => readCurrentStandings(jolpica.getDriverStandingsSnapshot);
/** The driver's record (what the [slug] layout reads first) answers now: the same request the page reuses. */
export const driverRecordAnswers = async ({ slug }: { slug: string }) => (await readDriverIdentity(slug)).state === 'found';

export async function currentSeasonDriverParams(read: StandingsRead = currentStandings, retry: RetryOptions = {}, probe: (param: { slug: string }) => Promise<boolean> = read === currentStandings ? driverRecordAnswers : async () => true): Promise<Array<{ slug: string }>> {
  try {
    // A transient failure is retried (bounded) before anything is left out of the prebuild.
    const table = await retryUnavailable(read, retry);
    if (table.state !== 'available' || !table.snapshot) return [];
    const ids = new Set(table.snapshot.standings.map((row) => row.Driver.driverId).filter((id) => validSlug.test(id)));
    // A driver whose record cannot be read now is left out of the prebuild, not baked as an outage (F-01).
    return await prebuildable([...ids].map((slug) => ({ slug })), probe);
  } catch {
    return [];
  }
}
