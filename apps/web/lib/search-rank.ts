import Fuse, { type IFuseOptions } from 'fuse.js';

export interface RankableSearchItem {
  kind: 'driver' | 'team' | 'race';
  slug: string;
  title: string;
  meta: string;
  /** On the current season's grid or calendar. Breaks ties in its favour. */
  current?: boolean;
}

/**
 * Exact-first search ranking.
 *
 * Tiers, highest first (a row takes its best tier):
 *   100  the whole title equals the query ("Ferrari")
 *    92  the record id equals the query: Jolpica gives the bare surname to the
 *        first driver of that name ("senna" is Ayrton, Bruno is "bruno_senna")
 *    90  every query word equals a title word (surname, team, "monaco")
 *    70  every query word starts a title word ("verst", "mcla")
 *    55  every query word equals a word in the meta line (team, circuit, country)
 *    45  every query word starts a meta word
 *    30  the query appears inside the title
 * A current-season row gets +8, so Max Verstappen (98) leads Jos (92).
 *
 * Fuzzy matching (typos such as "Verstapen") is used only when nothing matches
 * exactly, so "Monaco" never lists Maldonado and "Senna" never lists Boutsen.
 */
const TIER = { exactTitle: 100, exactId: 92, titleWords: 90, titlePrefix: 70, metaWords: 55, metaPrefix: 45, titleContains: 30 } as const;
const CURRENT_BOOST = 8;

function fold(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function words(text: string): string[] {
  const folded = fold(text);
  return folded ? folded.split(' ') : [];
}

export function scoreSearchItem(item: RankableSearchItem, query: string): number {
  const q = fold(query);
  if (!q) return 0;
  const qWords = q.split(' ');
  const title = fold(item.title);
  const titleWords = words(item.title);
  const metaWords = words(item.meta);
  const slug = fold(item.slug.replace(/[_-]+/g, ' '));
  let tier = 0;
  if (title === q) tier = TIER.exactTitle;
  else if (slug === q) tier = TIER.exactId;
  else if (qWords.every((w) => titleWords.includes(w))) tier = TIER.titleWords;
  else if (qWords.every((w) => titleWords.some((t) => t.startsWith(w)))) tier = TIER.titlePrefix;
  else if (qWords.every((w) => metaWords.includes(w))) tier = TIER.metaWords;
  else if (qWords.every((w) => metaWords.some((t) => t.startsWith(w)))) tier = TIER.metaPrefix;
  else if (title.includes(q)) tier = TIER.titleContains;
  if (!tier) return 0;
  return tier + (item.current ? CURRENT_BOOST : 0);
}

const FUZZY_OPTIONS: IFuseOptions<RankableSearchItem> = {
  // Typos are made in names, so fuzzy matching looks at titles only; matching
  // the meta line let "Verstapen" pull in "Silverstone".
  keys: ['title'],
  threshold: 0.34,
  ignoreLocation: true,
  includeScore: true,
  minMatchCharLength: 2,
  shouldSort: true,
};

export interface RankedSearch<T> {
  items: T[];
  mode: 'all' | 'exact' | 'fuzzy';
}

/**
 * Rank a corpus for a query. Stable for equal scores (corpus order, which the
 * search page builds current season first).
 */
export function rankSearch<T extends RankableSearchItem>(corpus: T[], query: string, fuzzy?: Pick<Fuse<T>, 'search'>): RankedSearch<T> {
  const q = query.trim();
  if (!q) return { items: corpus, mode: 'all' };
  const scored = corpus
    .map((item, index) => ({ item, index, score: scoreSearchItem(item, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item);
  if (scored.length > 0) return { items: scored, mode: 'exact' };
  const index = fuzzy ?? new Fuse(corpus, FUZZY_OPTIONS as IFuseOptions<T>);
  return { items: index.search(q).map((result) => result.item), mode: 'fuzzy' };
}

export function createFuzzyIndex<T extends RankableSearchItem>(corpus: T[]): Fuse<T> {
  return new Fuse(corpus, FUZZY_OPTIONS as IFuseOptions<T>);
}
