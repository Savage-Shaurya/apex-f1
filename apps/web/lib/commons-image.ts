import { titleFromWikiUrl } from '@apex/api-client/wikipedia';
import { firstPartyImageUrl } from './commons-proxy';
import {
  commonsBucket, commonsThumbUrl, getCommonsImage, getEnwikiP18, isRasterCommonsFile,
  type CommonsImage,
} from '@apex/api-client/wikimedia';

/**
 * Credited Wikimedia Commons photographs: circuit heroes (Wikidata P18 of the
 * circuit) and driver portraits. Every image carries the author and licence
 * Commons publishes, rendered by components/shell/ImageCredit.tsx. Images are
 * always bucketed /thumb/ renditions, never multi-megabyte originals.
 */

export interface ImageCredit {
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** The Commons file page, which holds the full attribution and licence. */
  sourceUrl: string;
}

export interface CreditedImage {
  src: string;
  width: number | null;
  height: number | null;
  alt: string;
  credit: ImageCredit;
}

const LOOKUP_DEADLINE_MS = 4_500;

/** A total render deadline across the dependent provider calls. */
function withDeadline<T>(work: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abort.abort();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), LOOKUP_DEADLINE_MS);
    void Promise.resolve().then(() => work(abort.signal)).then(finish, () => finish(null));
  });
}

/**
 * The URL a page renders for a bucketed Commons thumbnail: Apex's own
 * /media/commons/ path, so the browser never contacts Wikimedia (no Wikimedia
 * cookie, no visitor IP shared; final audit F-11).
 */
export function commonsDisplayUrl(fileName: string, width: number, originalWidth?: number | null): string | null {
  const upstream = commonsThumbUrl(fileName, width, originalWidth);
  return upstream ? firstPartyImageUrl(upstream) : null;
}

function credited(image: CommonsImage, alt: string, width: number): CreditedImage | null {
  const src = commonsDisplayUrl(image.fileName, width, image.width);
  if (!src) return null;
  const bucket = commonsBucket(width, image.width);
  const scale = image.width ? Math.min(1, bucket / image.width) : 1;
  return {
    src,
    width: image.width ? Math.round(image.width * scale) : null,
    height: image.height ? Math.round(image.height * scale) : null,
    alt,
    credit: { author: image.author, license: image.license, licenseUrl: image.licenseUrl, sourceUrl: image.pageUrl },
  };
}

/**
 * Words that mark a photograph of another series or event. A circuit hero on
 * an F1-only site must show F1 or the venue itself, not a MotoGP or
 * sportscar race (several circuits' Wikidata images do). "Moto" alone
 * catches titles like "Moto 1000 GP" (Jacarepagua's Wikidata image); truck
 * and stock-car terms catch Interlagos' "Final Copa Truck 2023" (D2-MEDIA-CREDITS-1).
 */
const OTHER_SERIES = /\b(moto ?gp|moto[23]|superbikes?|wsbk|motorbikes?|world endurance|wec|elms|european le mans|le mans|imsa|24h|etcr|wtcc|wtcr|tcr|dtm|gt3|gt4|gt world|blancpain|porsche (?:carrera|supercup|sprint|cup)|carrera panamericana|sprint challenge|indy ?car|nascar|supercars|formula e|formula 2|formula two|formula 3|formula three|formula 4|formula ford|formula 3000|f4|fia f2|fia f3|f1 academy|formula renault|euroformula|w series|gp2|gp3|rally|karting|motorcycles?|motocross|sidecars?|truck racing|copa truck|formula truck|f[oó]rmula truck|stock ?cars?|stock car pro|tc ?2000|super ?trofeo|ferrari challenge|lmp[123]?|hypercar|sportscars?|mx-5 cup|clio cup)\b/i;
/**
 * Broad words that only mark another event in a photo's own title or caption
 * ("Moto 1000 GP", "Final Copa Truck", "4 Hours of Spa"). They are not tested
 * against Commons categories, where they describe the venue ("Moto racing
 * venues in Brazil"). Bare Spanish "carrera" (race) is not a marker at all:
 * "Carrera de Fórmula 1" is an F1 race (R3-CODE-5).
 */
const OTHER_SERIES_IN_TITLE = /\b(moto|motos|trucks?|camion|turismo|[0-9]+ ?hours?)\b/i;
/** Categories that describe the place (venues, circuits, tracks), not the event photographed. */
const VENUE_CATEGORY = /\b(venues?|circuits?|race ?tracks?|racetracks?|autodromes?|aut[oó]dromos?|buildings|aerial photographs?)\b/i;

export function isOtherSeriesImage(image: Pick<CommonsImage, 'fileName' | 'description' | 'categories'>): boolean {
  const own = [image.fileName.replace(/_/g, ' '), image.description ?? ''].join(' \n ');
  const eventCategories = image.categories.filter((category) => !VENUE_CATEGORY.test(category));
  return OTHER_SERIES.test(own) || OTHER_SERIES_IN_TITLE.test(own) || OTHER_SERIES.test(eventCategories.join(' \n '));
}

const ENGLISH_HINT = /\b(the|of|at|on|during|view|views|aerial|track|circuit|race|racing|grand|prix|pit|pits|turn|corner|straight|grandstand|from|start|finish|lap|cars?|paddock|main)\b/i;

/**
 * Alt text for a circuit hero. Commons descriptions are often catalogue text
 * ("...: 168"), another language, or a file name, so they are added only when
 * they read as a short plain English caption; otherwise the alt is a plain
 * description of what the photo is.
 */
export function circuitHeroAlt(circuitName: string, description: string | null | undefined): string {
  const plain = /circuit|autodrom|ring\b|park|speedway|raceway|track|street/i.test(circuitName) ? circuitName : `${circuitName} circuit`;
  const text = (description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 12 || text.length > 140) return plain;
  if (!/^[\x20-\x7E]+$/.test(text)) return plain; // non-Latin script or unusual symbols
  if (/:\s*\d+\s*$|\b\d{3,}\b|\.(jpe?g|png|tiff?)\b|\bimg[_ ]?\d|\bdsc\w*\d/i.test(text)) return plain; // catalogue numbers, file names
  const words = text.split(' ').filter((word) => /[a-z]/i.test(word));
  if (words.length < 3 || !ENGLISH_HINT.test(text)) return plain;
  return `${circuitName}: ${text.replace(/[.\s]+$/, '')}`;
}

export interface CircuitHeroInput {
  circuitWikiUrl?: string | null;
  circuitName: string;
  revalidate?: number;
}

/**
 * Hero photograph for a race page: the Wikidata P18 image of the circuit.
 * Returns null (no hero) for maps/SVGs, images too small to fill the frame
 * sharply, photos of other series, or any provider failure.
 */
export async function getCircuitHeroImage(input: CircuitHeroInput): Promise<CreditedImage | null> {
  if (!input.circuitWikiUrl) return null;
  const title = titleFromWikiUrl(input.circuitWikiUrl);
  return withDeadline(async (signal) => {
    const options = { signal, revalidate: input.revalidate };
    const file = await getEnwikiP18(title, options);
    if (!file || !isRasterCommonsFile(file) || signal.aborted) return null;
    const image = await getCommonsImage(file, options);
    if (!image || !image.mime?.startsWith('image/') || image.mime === 'image/svg+xml') return null;
    if (!image.width || image.width < 1280) return null;
    if (isOtherSeriesImage(image)) return null;
    return credited(image, circuitHeroAlt(input.circuitName, image.description), 1920);
  });
}

/**
 * A Commons portrait (Wikidata P18 or the Wikipedia lead image) with its
 * credit. Single-wiki uploads (usually non-free) are rejected.
 */
export async function getCommonsPortrait(candidates: Array<string | null | undefined>, alt: string, width = 960): Promise<CreditedImage | null> {
  const files = candidates.filter((c): c is string => typeof c === 'string' && c.length > 0);
  if (!files.length) return null;
  return withDeadline(async (signal) => {
    for (const candidate of files) {
      if (signal.aborted) return null;
      const image = await getCommonsImage(candidate, { signal });
      if (!image || !image.mime?.startsWith('image/') || image.mime === 'image/svg+xml') continue;
      const result = credited(image, alt, width);
      if (result) return result;
    }
    return null;
  });
}
