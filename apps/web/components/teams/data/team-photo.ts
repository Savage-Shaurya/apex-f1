import { unstable_cache } from 'next/cache';
import { getCommonsPortrait, type CreditedImage } from '@/lib/commons-image';
import { outageConnection } from '@/lib/outage-connection';
import { teamCarAlt, teamCommonsCar } from '@/lib/team-commons-cars';

/**
 * The hand-picked Commons car of a historic team, read from Commons. Null
 * only when no car is picked or Commons answered with no usable image; a
 * failed lookup (429, timeout) throws, so the cache below never keeps it.
 * The alt text is set per page by teamCarPhoto, outside the cache.
 */
export async function readTeamCarImage(constructorId: string, options: { fetchImpl?: typeof fetch } = {}): Promise<CreditedImage | null> {
  const pick = teamCommonsCar(constructorId);
  if (!pick) return null;
  return getCommonsPortrait([pick.file], pick.car, 1280, { strict: true, ...options });
}

/**
 * One cache entry per constructor id, for a day: the team pages, the past
 * champion cards and /references read the very same result, so a photo a
 * page shows is always the one /references credits (review 2026-11-01: the
 * entry used to be keyed by the caller's team name, three keys per photo).
 */
export const cachedTeamCarImage = unstable_cache(
  async (constructorId: string): Promise<CreditedImage | null> => readTeamCarImage(constructorId),
  ['apex-team-commons-car-v2'],
  { revalidate: 86_400 },
);

export interface TeamCarPhoto {
  image: CreditedImage | null;
  /** Commons did not answer: the render is kept only briefly (outageConnection) and retried. */
  failed: boolean;
}

export interface TeamCarDeps {
  read?: (constructorId: string) => Promise<CreditedImage | null>;
  onFailure?: () => Promise<void>;
}

/**
 * A team's Commons car with its alt text for this page. On a failed lookup it
 * calls outageConnection() (the render is kept 60 s, not the route's window)
 * and answers `{ image: null, failed: true }`; it never throws for Commons.
 */
export async function teamCarPhoto(constructorId: string, teamName: string, deps: TeamCarDeps = {}): Promise<TeamCarPhoto> {
  const pick = teamCommonsCar(constructorId);
  if (!pick) return { image: null, failed: false };
  let image: CreditedImage | null;
  try {
    image = await (deps.read ?? cachedTeamCarImage)(constructorId);
  } catch {
    await (deps.onFailure ?? outageConnection)();
    return { image: null, failed: true };
  }
  return { image: image ? { ...image, alt: teamCarAlt(teamName, pick) } : null, failed: false };
}

/** The credited Commons photo of a historic team's car, or null (none picked, none usable, or Commons down). */
export async function getTeamCommonsCar(constructorId: string, teamName: string, deps: TeamCarDeps = {}): Promise<CreditedImage | null> {
  return (await teamCarPhoto(constructorId, teamName, deps)).image;
}
