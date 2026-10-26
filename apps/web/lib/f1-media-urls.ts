/**
 * URL conventions of the official F1 media CDN (media.formula1.com, a
 * Cloudinary deployment). Approved by the user on 2026-10-25 and credited in
 * the footer (lib/credits.ts). Pure functions: no network, safe anywhere.
 *
 * Verified with curl on 2026-10-25 for every 2026 driver and all 11 teams:
 *   common/f1/{season}/{team}/{ref}/{season}{team}{ref}right.webp   driver cut-out, 2000x5750 master
 *   common/f1/{season}/{team}/{season}{team}carright.webp           car, 3840x845 master
 *   common/f1/{season}/{team}/{season}{team}logowhite.svg           white logo, vector
 * Missing assets answer 404 (e.g. 2025 audi/cadillac), so lookups that
 * HEAD-validate a URL (lib/f1-media.ts) never show a guessed image.
 *
 * Cloudinary transformations deliver sharp, light renditions from those
 * masters: `w_` picks the width, `q_auto,f_auto` negotiate AVIF/WebP, and
 * `c_fill,g_north,ar_1:1` frames the head and shoulders of a cut-out the way
 * F1's own driver cards do. The `w_` value is rewritten per srcset candidate
 * by lib/image-renditions.ts.
 */

export const F1_MEDIA_UPLOAD = 'https://media.formula1.com/image/upload';

/** Jolpica constructorId -> CDN team folder for the current era. */
const FOLDER_BY_CONSTRUCTOR: Record<string, string> = {
  mclaren: 'mclaren',
  ferrari: 'ferrari',
  mercedes: 'mercedes',
  red_bull: 'redbullracing',
  rb: 'racingbulls',
  aston_martin: 'astonmartin',
  alpine: 'alpine',
  williams: 'williams',
  haas: 'haasf1team',
  audi: 'audi',
  cadillac: 'cadillac',
};
const KNOWN_FOLDERS = new Set(Object.values(FOLDER_BY_CONSTRUCTOR));

/**
 * CDN team folder. OpenF1's `team_name` collapses to the folder name
 * ("Haas F1 Team" -> "haasf1team"), which survives Jolpica id changes; the
 * Jolpica map is the fallback when no timing row is available.
 */
export function f1TeamFolder(constructorId: string | null | undefined, openF1TeamName?: string | null): string | null {
  const fromTiming = openF1TeamName?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (KNOWN_FOLDERS.has(fromTiming)) return fromTiming;
  return (constructorId && FOLDER_BY_CONSTRUCTOR[constructorId]) || null;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Candidate FOM driver references, most reliable first: the one embedded in
 * OpenF1's `headshot_url` (".../LANNOR01_Lando_Norris/lannor01.png"), then
 * FOM's naming rule (three letters of each name + "01"), which every 2026
 * driver follows. Each candidate is HEAD-validated before use.
 */
export function f1DriverRefs(input: { headshotUrl?: string | null; firstName?: string | null; lastName?: string | null }): string[] {
  const refs: string[] = [];
  const embedded = input.headshotUrl?.match(/\/drivers\/[A-Z]\/[A-Z]{6}\d{2}_[^/]+\/([a-z]{6}\d{2})\.png/);
  if (embedded?.[1]) refs.push(embedded[1]);
  const first = fold(input.firstName ?? '');
  const last = fold(input.lastName ?? '');
  if (first.length >= 3 && last.length >= 3) {
    const ref = `${first.slice(0, 3)}${last.slice(0, 3)}01`;
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

const SAFE_SEGMENT = /^[a-z0-9]{2,40}$/;
function validSeason(season: number): boolean {
  return Number.isSafeInteger(season) && season >= 2018 && season <= 9999;
}

/** Untransformed master path, used for HEAD validation. */
export function f1DriverAssetPath(season: number, folder: string, ref: string): string | null {
  if (!validSeason(season) || !SAFE_SEGMENT.test(folder) || !SAFE_SEGMENT.test(ref)) return null;
  return `common/f1/${season}/${folder}/${ref}/${season}${folder}${ref}right.webp`;
}

export function f1TeamCarPath(season: number, folder: string): string | null {
  if (!validSeason(season) || !SAFE_SEGMENT.test(folder)) return null;
  return `common/f1/${season}/${folder}/${season}${folder}carright.webp`;
}

export function f1TeamLogoPath(season: number, folder: string): string | null {
  if (!validSeason(season) || !SAFE_SEGMENT.test(folder)) return null;
  return `common/f1/${season}/${folder}/${season}${folder}logowhite.svg`;
}

export function f1MasterUrl(path: string): string {
  return `${F1_MEDIA_UPLOAD}/${path}`;
}

/** Head-and-shoulders square from the full-body cut-out (transparent). */
export function f1HeadshotUrl(path: string, width = 840): string {
  return `${F1_MEDIA_UPLOAD}/c_fill,g_north,ar_1:1,w_${width},q_auto,f_auto/${path}`;
}

/** Whole subject, scaled to fit: full-body cut-outs and cars. */
export function f1FitUrl(path: string, width = 1280): string {
  return `${F1_MEDIA_UPLOAD}/c_fit,w_${width},q_auto,f_auto/${path}`;
}

/**
 * Frame an F1 media cut-out for a portrait slot. Cloudinary fills the frame's
 * aspect ratio anchored to the top (`c_fill,g_north`), so a full-body master
 * becomes a waist-up (4:5) or head-and-shoulders (1:1) picture with the head
 * at the same height in every frame. The transparent ground is kept, so the
 * portrait field shows through. Any other URL is returned unchanged.
 */
export function f1FramedCutout(src: string, aspect = '4:5', width = 640): string {
  if (!/^\d{1,4}(?:\.\d{1,3})?:\d{1,4}(?:\.\d{1,3})?$/.test(aspect) || !Number.isSafeInteger(width) || width < 16 || width > 4000) return src;
  const m = src.match(/^https:\/\/media\.formula1\.com\/image\/upload\/(?:[^/]*\b(?:c_|w_)[^/]*\/)?(common\/f1\/\d{4}\/[a-z0-9]+\/[a-z0-9]+\/[a-z0-9]+(?:right|left)\.webp)$/);
  if (!m) return src;
  return `${F1_MEDIA_UPLOAD}/c_fill,g_north,ar_${aspect},w_${width},q_auto,f_auto/${m[1]}`;
}

/** CSS aspect-ratio ("4 / 5") to a Cloudinary `ar_` value ("4:5"); null when unparseable. */
export function cloudinaryAspect(ratio: string): string | null {
  const m = ratio.match(/^\s*(\d{1,4}(?:\.\d{1,3})?)\s*\/\s*(\d{1,4}(?:\.\d{1,3})?)\s*$/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** True for pictures that are photographs (opaque ground) rather than transparent cut-outs. */
export function isPhotograph(src: string | null | undefined): boolean {
  if (!src) return false;
  return /^https:\/\/(?:upload|thumb|commons)\.wikimedia\.org\//.test(src) || src.startsWith('/media/commons/') || src.startsWith(F1_LEGACY_DRIVERS + '/');
}

/**
 * Official season portraits from the F1 media archive (studio photographs,
 * 1920x1920 masters) for title years before the 2024 cut-out masters:
 *   content/dam/fom-website/drivers/{season}Drivers/{surname}.jpg
 * Verified with curl on 2026-10-26: 2015 and 2019-2023 answer 200, 2016-2018
 * and 2014 earlier answer 404. Renditions: `.img.{320|480|640|960|1536|1920}.medium.jpg`.
 */
export const F1_LEGACY_DRIVERS = 'https://media.formula1.com/content/dam/fom-website/drivers';

export function f1SeasonPortraitPath(season: number, lastName: string): string | null {
  if (!Number.isSafeInteger(season) || season < 2014 || season > 2023) return null;
  const surname = fold(lastName);
  if (surname.length < 2) return null;
  return `${F1_LEGACY_DRIVERS}/${season}Drivers/${surname}.jpg`;
}

export function f1SeasonPortraitUrl(master: string, width = 640): string {
  return `${master}.img.${width}.medium.jpg`;
}
