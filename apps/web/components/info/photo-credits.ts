import { mapDriverStanding } from '@apex/api-client/jolpica';
import { getCircuitHeroImage, type CreditedImage } from '@/lib/commons-image';
import { getCalendar } from '@/lib/grid';
import { getSeasonContext } from '@/lib/season';
import { loadDriverChampionshipArchive } from '@/components/data/load-championship-archive';
import { championPortraits } from '@/components/drivers/data/champion-portraits';

/** One Wikimedia Commons photograph the site shows, with the attribution its licence asks for. */
export interface PhotoCredit {
  /** What the photo shows ("Circuit of the Americas", "Ayrton Senna"). */
  subject: string;
  /** Where on Apex it appears. */
  usedOn: string;
  author: string | null;
  license: string | null;
  licenseUrl: string | null;
  /** The Commons file page (full attribution and licence). */
  sourceUrl: string;
}

export interface PhotoCredits {
  circuits: PhotoCredit[];
  champions: PhotoCredit[];
  /** False when a lookup failed, so the page can say the list may be incomplete. */
  complete: boolean;
}

const toCredit = (subject: string, usedOn: string, image: Pick<CreditedImage, 'credit'>): PhotoCredit => ({
  subject,
  usedOn,
  author: image.credit.author,
  license: image.credit.license,
  licenseUrl: image.credit.licenseUrl,
  sourceUrl: image.credit.sourceUrl,
});

/** Same photo used for several subjects is listed once. */
export function uniqueBySource(list: PhotoCredit[]): PhotoCredit[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.sourceUrl) ? false : (seen.add(c.sourceUrl), true)));
}

/**
 * The Commons photographs Apex shows, read through the very lookups the pages
 * use (the season's circuit photographs on the home and race pages, the
 * champions' portraits in the hall), so the list matches what is on screen.
 */
export async function loadPhotoCredits(): Promise<PhotoCredits> {
  let complete = true;
  const circuitsP = (async () => {
    try {
      const calendar = await getCalendar();
      if (calendar.state !== 'available') { complete = false; return []; }
      const seen = new Map<string, { name: string; wiki: string }>();
      for (const r of calendar.races) if (r.circuitWikiUrl && !seen.has(r.circuitWikiUrl)) seen.set(r.circuitWikiUrl, { name: r.circuitName, wiki: r.circuitWikiUrl });
      const photos = await Promise.all([...seen.values()].map(async (c) => {
        const image = await getCircuitHeroImage({ circuitWikiUrl: c.wiki, circuitName: c.name, revalidate: 86_400 }).catch(() => null);
        return image ? toCredit(c.name, `Home and the ${calendar.season} race pages`, image) : null;
      }));
      return photos.filter((p): p is PhotoCredit => p !== null);
    } catch {
      complete = false;
      return [];
    }
  })();
  const championsP = (async () => {
    try {
      const { lastCompletedSeason } = await getSeasonContext();
      const archive = await loadDriverChampionshipArchive(lastCompletedSeason);
      if (archive.state !== 'complete') complete = false;
      const people = Array.from(new Map(archive.records.map(({ winner }) => {
        const s = mapDriverStanding(winner);
        return [s.driver.slug, { key: s.driver.slug, wikiUrl: s.driver.wikiUrl || null, name: s.driver.fullName }] as const;
      })).values());
      const portraits = await championPortraits(people);
      return people.flatMap((p) => {
        const image = portraits.get(p.key);
        return image ? [toCredit(p.name, 'World champions', image)] : [];
      });
    } catch {
      complete = false;
      return [];
    }
  })();
  const [circuits, champions] = await Promise.all([circuitsP, championsP]);
  return { circuits: uniqueBySource(circuits), champions: uniqueBySource(champions), complete };
}
