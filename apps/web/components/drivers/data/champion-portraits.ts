import { unstable_cache } from 'next/cache';
import { getDriverFactsByQid, getWikipediaSummaryByUrl } from '@apex/api-client/wikipedia';
import { getCommonsPortrait, type ImageCredit } from '@/lib/commons-image';
import { outageConnection } from '@/lib/outage-connection';

export interface ChampionPortrait {
  src: string;
  credit: ImageCredit;
}

/**
 * A credited Wikimedia Commons portrait for a champion: Wikidata P18 of the
 * driver's Wikipedia article, else the article's lead image. Cached for a day
 * per driver (the archive has 35 champions); null when Commons has no free
 * image, in which case the plaque is set in type alone. A failed lookup
 * (429, timeout) throws, so the cache never keeps it (review 2026-11-01).
 */
const portraitFor = unstable_cache(
  async (wikiUrl: string, name: string): Promise<ChampionPortrait | null> => {
    const summary = await getWikipediaSummaryByUrl(wikiUrl, { revalidate: 86400 });
    // The reader answers null on a failed request too; a champion's article always exists.
    if (!summary) throw new Error('Wikipedia summary unavailable');
    const facts = summary.wikidataId ? await getDriverFactsByQid(summary.wikidataId, { revalidate: 86400 }) : null;
    const image = await getCommonsPortrait([facts?.imageUrl, summary.originalImageUrl, summary.thumbnailUrl], name, 640, { strict: true });
    return image ? { src: image.src, credit: image.credit } : null;
  },
  ['apex-champion-portrait-v2'],
  { revalidate: 86400 },
);

export interface ChampionPortraitDeps {
  read?: (wikiUrl: string, name: string) => Promise<ChampionPortrait | null>;
  onFailure?: () => Promise<void>;
}

/**
 * Portraits for many champions with at most `limit` lookups in flight. A
 * failed lookup leaves that champion in type and marks the render degraded
 * once (outageConnection: kept 60 s, then retried).
 */
export async function championPortraits(people: ReadonlyArray<{ key: string; wikiUrl: string | null; name: string }>, limit = 6, deps: ChampionPortraitDeps = {}): Promise<Map<string, ChampionPortrait>> {
  const out = new Map<string, ChampionPortrait>();
  const read = deps.read ?? portraitFor;
  let failed = false;
  const queue = people.filter((p) => p.wikiUrl);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= queue.length) return;
      const p = queue[i]!;
      try {
        const portrait = await read(p.wikiUrl!, p.name);
        if (portrait) out.set(p.key, portrait);
      } catch {
        failed = true;
      }
    }
  }));
  if (failed) await (deps.onFailure ?? outageConnection)();
  return out;
}
