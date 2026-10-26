import { unstable_cache } from 'next/cache';
import { probeF1MediaAssetStrict } from './headshot-probe';
import {
  f1DriverAssetPath, f1DriverRefs, f1FitUrl, f1HeadshotUrl, f1MasterUrl,
  f1SeasonPortraitPath, f1SeasonPortraitUrl, f1TeamCarPath, f1TeamFolder, f1TeamLogoPath,
} from './f1-media-urls';

/**
 * Verified F1 media CDN images for the current grid. Every URL returned here
 * was HEAD-validated (200, image type, plausible size) within the last day;
 * anything else is null, so callers fall back to OpenF1, Wikimedia or the
 * typographic placeholder instead of rendering a guessed URL.
 */

const DAY = 86_400;

// One probe per master URL per day, shared by every page and request. Only a
// definitive answer is cached: an inconclusive probe (timeout, network, 5xx)
// throws, is not stored, and reads as "no image" for this render only.
const cachedCutout = unstable_cache(
  (url: string) => probeF1MediaAssetStrict(url, { minBytes: 20_000 }),
  ['apex-f1-media-cutout-v2'],
  { revalidate: DAY },
);
const cachedCar = unstable_cache(
  (url: string) => probeF1MediaAssetStrict(url, { minBytes: 20_000 }),
  ['apex-f1-media-car-v2'],
  { revalidate: DAY },
);
const cachedLogo = unstable_cache(
  (url: string) => probeF1MediaAssetStrict(url, { minBytes: 100, allowSvg: true }),
  ['apex-f1-media-logo-v2'],
  { revalidate: DAY },
);
const cachedSeasonPortrait = unstable_cache(
  (url: string) => probeF1MediaAssetStrict(url, { minBytes: 20_000 }),
  ['apex-f1-media-season-portrait-v1'],
  { revalidate: DAY },
);
const settle = (probe: (url: string) => Promise<string | null>) => (url: string) => probe(url).catch(() => null);
const probeCutout = settle(cachedCutout);
const probeCar = settle(cachedCar);
const probeLogo = settle(cachedLogo);
const probeSeasonPortrait = settle(cachedSeasonPortrait);

export interface DriverMedia {
  /** Transparent head-and-shoulders square (render with fit="contain"). */
  headshot: string;
  /** Transparent full-body cut-out, about 1:2.9 (render with fit="contain"). */
  cutout: string;
}

export interface DriverMediaInput {
  season: number | null;
  constructorId: string | null;
  openF1TeamName?: string | null;
  openF1HeadshotUrl?: string | null;
  firstName: string;
  lastName: string;
}

export async function getDriverMedia(input: DriverMediaInput): Promise<DriverMedia | null> {
  if (input.season === null) return null;
  const folder = f1TeamFolder(input.constructorId, input.openF1TeamName);
  if (!folder) return null;
  for (const ref of f1DriverRefs({ headshotUrl: input.openF1HeadshotUrl, firstName: input.firstName, lastName: input.lastName })) {
    const path = f1DriverAssetPath(input.season, folder, ref);
    if (!path) continue;
    if (await probeCutout(f1MasterUrl(path))) return { headshot: f1HeadshotUrl(path), cutout: f1FitUrl(path, 960) };
  }
  return null;
}

export interface TeamMedia {
  /** Side-on car, about 4.5:1 (render with fit="contain"). */
  car: string | null;
  /** White vector logo (render with fit="contain"). */
  logo: string | null;
}

export async function getTeamMedia(season: number | null, constructorId: string, openF1TeamName?: string | null): Promise<TeamMedia> {
  const folder = season === null ? null : f1TeamFolder(constructorId, openF1TeamName);
  if (season === null || !folder) return { car: null, logo: null };
  const carPath = f1TeamCarPath(season, folder);
  const logoPath = f1TeamLogoPath(season, folder);
  const [car, logo] = await Promise.all([
    carPath ? probeCar(f1MasterUrl(carPath)) : null,
    logoPath ? probeLogo(f1MasterUrl(logoPath)) : null,
  ]);
  return {
    car: car && carPath ? f1FitUrl(carPath, 1600) : null,
    logo: logo && logoPath ? f1MasterUrl(logoPath) : null,
  };
}

/**
 * The official F1 media studio portrait of a driver for one season (archive
 * years 2014-2023, see f1SeasonPortraitPath). HEAD-validated like the cut-outs;
 * null when the archive has no picture for that season and surname.
 */
export async function getSeasonPortrait(season: number, lastName: string): Promise<string | null> {
  const master = f1SeasonPortraitPath(season, lastName);
  if (!master) return null;
  return (await probeSeasonPortrait(master)) ? f1SeasonPortraitUrl(master, 640) : null;
}
