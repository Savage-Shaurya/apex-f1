/**
 * Picking what fills a page hero. Every hero shows something real when the
 * page has it: real photographs first, then a real graphic (a circuit
 * outline, the team's livery), never an empty box and never an invented
 * picture. These helpers are pure so the choice is tested.
 */

export interface HeroTile {
  key: string;
  src: string;
  href: string;
  /** What the picture is (a headline or video title): the link's accessible name. */
  title: string;
  /** Short fact under it (publisher, channel). */
  meta?: string;
  /** Accessible name when it differs from the title (video play links). */
  label?: string;
  /** Extra data-* attributes on the link (the video player's contract). */
  attrs?: Record<string, string | undefined>;
}

/**
 * Up to `max` tiles with a usable picture, in the given order, one per
 * picture and one per link (syndicated copies often share both).
 */
export function pickHeroTiles<T>(items: readonly T[], toTile: (item: T) => HeroTile | null, max = 3): HeroTile[] {
  const out: HeroTile[] = [];
  const seenSrc = new Set<string>();
  const seenHref = new Set<string>();
  for (const item of items) {
    if (out.length >= max) break;
    const tile = toTile(item);
    if (!tile || !tile.src || !/^(https?:)?\/\//.test(tile.src) && !tile.src.startsWith('/')) continue;
    if (seenSrc.has(tile.src) || seenHref.has(tile.href)) continue;
    seenSrc.add(tile.src);
    seenHref.add(tile.href);
    out.push(tile);
  }
  return out;
}

/** Tiles from a preferred pool, topped up from a second pool when the first has too few pictures. */
export function pickHeroTilesFrom<T>(pools: ReadonlyArray<readonly T[]>, toTile: (item: T) => HeroTile | null, max = 3): HeroTile[] {
  return pickHeroTiles(pools.flat(), toTile, max);
}

export type TeamHeroVisual = 'car' | 'photo' | 'emblem';

/**
 * The team hero's picture: the F1 media car (current teams), else a real
 * credited Commons photo of the team's car, else the livery emblem (team
 * colour and the name in outline). Never nothing.
 */
export function teamHeroVisual({ car, photo }: { car: string | null | undefined; photo: string | null | undefined }): TeamHeroVisual {
  if (car) return 'car';
  if (photo) return 'photo';
  return 'emblem';
}
