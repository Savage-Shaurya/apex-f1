import { jolpica } from '@apex/api-client/jolpica';
import { prebuildable, readConstructorIdentity, readPublicSport, retryUnavailable, SPORT_READ_OPTIONS, type RetryOptions } from '@/lib/public-sport';

type ConstructorList = Pick<typeof jolpica, 'getConstructors'>;

/**
 * The current season's team slugs, prebuilt at `next build` so their pages
 * are cached from the first visit and a later provider outage keeps serving
 * them (the [slug] layout throws; ISR keeps the last good render). Any other
 * constructor renders on its first visit (dynamicParams). If the list can't
 * be read during the build nothing is prebuilt: the build never fails or
 * bakes an outage into a page because of it.
 */
/** The team's record (what its [slug] layout reads first) answers now: the same request the page reuses. */
export const teamRecordAnswers = async ({ slug }: { slug: string }) => (await readConstructorIdentity(slug)).state === 'found';

export async function currentTeamParams(provider: ConstructorList = jolpica, retry: RetryOptions = {}, probe: (param: { slug: string }) => Promise<boolean> = provider === jolpica ? teamRecordAnswers : async () => true): Promise<{ slug: string }[]> {
  // A transient failure is retried (bounded) before anything is left out of the prebuild (red_bull/rb were skipped once).
  const read = await retryUnavailable(() => readPublicSport(() => provider.getConstructors('current', { ...SPORT_READ_OPTIONS, revalidate: 3600 })), retry);
  if (read.state === 'unavailable') return [];
  const params = [...new Set(read.data.map((c) => c.constructorId).filter((id) => /^[a-zA-Z0-9_-]{1,160}$/.test(id)))].map((slug) => ({ slug }));
  // A team whose record cannot be read now is left out of the prebuild, not baked as an outage (F-01).
  return prebuildable(params, probe);
}
