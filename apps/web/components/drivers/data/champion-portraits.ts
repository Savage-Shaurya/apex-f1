import { unstable_cache } from 'next/cache';
import { getDriverFactsByQid, getWikipediaSummaryByUrl } from '@apex/api-client/wikipedia';
import { getCommonsPortrait, type ImageCredit } from '@/lib/commons-image';

export interface ChampionPortrait {
  src: string;
  credit: ImageCredit;
}

/**
 * A credited Wikimedia Commons portrait for a champion: Wikidata P18 of the
 * driver's Wikipedia article, else the article's lead image. Cached for a day
 * per driver (the archive has 35 champions); null when Commons has no free
 * image, in which case the plaque is set in type alone.
 */
const portraitFor = unstable_cache(
  async (wikiUrl: string, name: string): Promise<ChampionPortrait | null> => {
    try {
      const summary = await getWikipediaSummaryByUrl(wikiUrl, { revalidate: 86400 });
      if (!summary) return null;
      const facts = summary.wikidataId ? await getDriverFactsByQid(summary.wikidataId, { revalidate: 86400 }) : null;
      const image = await getCommonsPortrait([facts?.imageUrl, summary.originalImageUrl, summary.thumbnailUrl], name, 640);
      return image ? { src: image.src, credit: image.credit } : null;
    } catch {
      return null;
    }
  },
  ['apex-champion-portrait-v2'],
  { revalidate: 86400 },
);

/** Portraits for many champions with at most `limit` lookups in flight. */
export async function championPortraits(people: ReadonlyArray<{ key: string; wikiUrl: string | null; name: string }>, limit = 6): Promise<Map<string, ChampionPortrait>> {
  const out = new Map<string, ChampionPortrait>();
  const queue = people.filter((p) => p.wikiUrl);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const p = queue[i]!;
      const portrait = await portraitFor(p.wikiUrl!, p.name);
      if (portrait) out.set(p.key, portrait);
    }
  }));
  return out;
}
