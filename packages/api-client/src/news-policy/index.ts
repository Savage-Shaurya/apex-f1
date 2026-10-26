/**
 * Formula 1 news policy: the code form of docs/NEWS-POLICY.md.
 *
 * Every story that reaches a rendered page passes through `classifyNewsItem`.
 * Two inputs decide the verdict:
 *
 *   1. Where the story came from. Publisher-curated F1 feeds (our four RSS
 *      feeds and the Guardian's Formula One tag) are trusted to be about F1
 *      unless the headline names another series or sport. Keyword-search APIs
 *      (GNews, NewsData, NewsAPI, Currents) match on body text, so their rows
 *      must come from an allowlisted publisher and carry an F1 signal.
 *   2. What the headline is about. Other series (F2, F3, F1 Academy, IndyCar,
 *      NASCAR, MotoGP, Formula E, WEC, karting, ...), other sports, gambling,
 *      calculators and streaming guides are rejected outright.
 *
 * The classifier never invents data: it only removes rows and, for API rows,
 * replaces a provider label with the publisher's real name from the allowlist.
 */

export type NewsProviderKind = 'rss' | 'guardian' | 'newsapi' | 'newsdata' | 'gnews' | 'currents';

export type NewsRejectReason =
  | 'invalid-link'
  | 'blocked-source'
  | 'unlisted-source'
  | 'other-sport'
  | 'low-value'
  | 'other-series'
  | 'not-f1';

export type NewsVerdict =
  | { allowed: true; publisher?: string }
  | { allowed: false; reason: NewsRejectReason };

export interface ClassifiableNewsItem {
  title: string;
  link: string;
  description?: string;
  categories?: string[];
  provider?: NewsProviderKind;
}

/**
 * How much of a publisher's output is Formula 1.
 *  - `f1`: an F1-only newsroom. Only the other-series rule applies.
 *  - `motorsport`: a multi-series newsroom. Needs an F1 signal in the headline.
 *  - `general`: a general or multi-sport outlet. Needs an explicit F1 term in
 *    the headline, or one in the summary backed by F1 vocabulary in the headline.
 */
export type PublisherScope = 'f1' | 'motorsport' | 'general';

export interface PublisherRule {
  host: string;
  name: string;
  scope: PublisherScope;
}

/** Publishers whose links open without a hard paywall or consent wall. */
export const NEWS_PUBLISHER_ALLOWLIST: readonly PublisherRule[] = [
  // F1-only newsrooms
  { host: 'formula1.com', name: 'Formula 1', scope: 'f1' },
  { host: 'planetf1.com', name: 'PlanetF1', scope: 'f1' },
  { host: 'gpblog.com', name: 'GPblog', scope: 'f1' },
  { host: 'racingnews365.com', name: 'RacingNews365', scope: 'f1' },
  { host: 'f1i.com', name: 'F1i', scope: 'f1' },
  { host: 'gpfans.com', name: 'GPFans', scope: 'f1' },
  { host: 'f1technical.net', name: 'F1Technical', scope: 'f1' },
  { host: 'pitpass.com', name: 'Pitpass', scope: 'f1' },
  { host: 'formu1a.uno', name: 'Formu1a.uno', scope: 'f1' },
  { host: 'f1-insider.com', name: 'F1-Insider', scope: 'f1' },
  { host: 'formel1.de', name: 'Formel1.de', scope: 'f1' },
  // Multi-series motorsport newsrooms
  { host: 'motorsport.com', name: 'Motorsport.com', scope: 'motorsport' },
  { host: 'autosport.com', name: 'Autosport', scope: 'motorsport' },
  { host: 'the-race.com', name: 'The Race', scope: 'motorsport' },
  { host: 'racefans.net', name: 'RaceFans', scope: 'motorsport' },
  { host: 'crash.net', name: 'Crash.net', scope: 'motorsport' },
  { host: 'racer.com', name: 'RACER', scope: 'motorsport' },
  { host: 'speedcafe.com', name: 'Speedcafe', scope: 'motorsport' },
  { host: 'motorsportweek.com', name: 'Motorsport Week', scope: 'motorsport' },
  { host: 'motorsport-total.com', name: 'Motorsport-Total', scope: 'motorsport' },
  { host: 'auto-motor-und-sport.de', name: 'auto motor und sport', scope: 'motorsport' },
  { host: 'nextgen-auto.com', name: 'Nextgen-Auto', scope: 'motorsport' },
  { host: 'fia.com', name: 'FIA', scope: 'motorsport' },
  // General outlets with a free F1 desk
  { host: 'theguardian.com', name: 'The Guardian', scope: 'general' },
  { host: 'bbc.co.uk', name: 'BBC Sport', scope: 'general' },
  { host: 'bbc.com', name: 'BBC Sport', scope: 'general' },
  { host: 'skysports.com', name: 'Sky Sports', scope: 'general' },
  { host: 'espn.com', name: 'ESPN', scope: 'general' },
  { host: 'espn.co.uk', name: 'ESPN', scope: 'general' },
  { host: 'espn.in', name: 'ESPN', scope: 'general' },
  { host: 'reuters.com', name: 'Reuters', scope: 'general' },
  { host: 'apnews.com', name: 'AP', scope: 'general' },
  { host: 'cnn.com', name: 'CNN', scope: 'general' },
  { host: 'independent.co.uk', name: 'The Independent', scope: 'general' },
  { host: 'sportingnews.com', name: 'Sporting News', scope: 'general' },
  { host: 'cbssports.com', name: 'CBS Sports', scope: 'general' },
  { host: 'nbcsports.com', name: 'NBC Sports', scope: 'general' },
  { host: 'abc.net.au', name: 'ABC', scope: 'general' },
  { host: 'marca.com', name: 'Marca', scope: 'general' },
  { host: 'as.com', name: 'AS', scope: 'general' },
  { host: 'gazzetta.it', name: 'La Gazzetta dello Sport', scope: 'general' },
];

/**
 * Hosts never shown, whatever feed delivers them. Each entry was observed
 * failing for readers (2026-10-25 audit) or sits behind a hard paywall.
 */
export const NEWS_BLOCKED_HOSTS: readonly { host: string; why: string }[] = [
  // USA TODAY Network: HTTP 402 paywall on every observed story.
  ...['usatoday.com', 'cincinnati.com', 'courierpress.com', 'jconline.com', 'heraldtimesonline.com', 'heraldtribune.com', 'thestarpress.com', 'southbendtribune.com', 'lancastereaglegazette.com', 'indystar.com', 'courier-journal.com', 'tennessean.com', 'freep.com', 'azcentral.com', 'desmoinesregister.com', 'jsonline.com']
    .map((host) => ({ host, why: 'HTTP 402 paywall (USA TODAY Network)' })),
  { host: 'ndtv.com', why: 'HTTP 403 to readers; images blocked cross-origin' },
  { host: 'ndtvimg.com', why: 'Images blocked cross-origin (ORB)' },
  { host: 'yahoo.com', why: 'Redirects EU readers to a consent wall' },
  { host: 'news.google.com', why: 'Redirect wrapper with a consent wall, not the publisher' },
  { host: 'msn.com', why: 'Syndication wrapper, not the publisher' },
  { host: 'reddit.com', why: 'Discussion threads, not reporting; HTTP 403 to readers' },
  { host: 'redd.it', why: 'Discussion threads, not reporting' },
  ...['nytimes.com', 'theathletic.com', 'wsj.com', 'ft.com', 'thetimes.co.uk', 'thetimes.com', 'telegraph.co.uk', 'bloomberg.com', 'economist.com']
    .map((host) => ({ host, why: 'Hard paywall' })),
];

const FEED_CURATED: ReadonlySet<NewsProviderKind> = new Set(['rss', 'guardian']);

function matchesHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/** Lowercased hostname without `www.`, or null for anything that is not an http(s) URL. */
export function newsHost(link: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function publisherFor(link: string): PublisherRule | undefined {
  const host = newsHost(link);
  if (!host) return undefined;
  return NEWS_PUBLISHER_ALLOWLIST.find((rule) => matchesHost(host, rule.host));
}

export function isBlockedNewsHost(link: string): boolean {
  const host = newsHost(link);
  if (!host) return false;
  return NEWS_BLOCKED_HOSTS.some((rule) => matchesHost(host, rule.host));
}

/** Folds case, accents and typographic punctuation so the patterns stay simple. */
function fold(text: string): string {
  return ` ${text}`
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;|[’‘]/g, "'")
    .replace(/&#822[01];|&ldquo;|&rdquo;|[“”]/g, '"')
    .replace(/&amp;/g, '&')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .concat(' ');
}

// F1 Academy carries the "F1" brand but is a different championship, so it is
// removed before any F1 signal is looked for.
const F1_ACADEMY = /\bf1 academy\b/g;

/** Unambiguous Formula 1 naming in several languages. */
const STRICT_F1 = /\bformula (?:1|one)\b|\bf1\b|\bformule 1\b|\bformel 1\b|\bfia formula one\b/;

/** Grand Prix naming, shared with MotoGP, so it only counts without another series. */
const GRAND_PRIX = /\bgrands? prix\b|\bgp\b|\bgran premio\b|\bgrande premio\b/;

/** Other championships. A headline naming one is rejected unless it also names F1. */
const OTHER_SERIES = new RegExp([
  'f1 academy', 'formula (?:2|two|3|three|4|four|e)', 'f[234]', 'fia f[234]', 'formula regional', 'eurocup',
  'indycar', 'indy ?500', 'indy nxt', 'nascar', 'motogp', 'moto[23]', 'worldsbk', 'superbikes?', 'isle of man tt',
  'wec', 'world endurance', 'le mans', 'imsa', 'daytona', 'wrc', 'world rally', 'rallye', 'dakar', 'dtm', 'supercars',
  'super formula', 'super gt', 'btcc', 'extreme e', 'gt[34]', 'porsche (?:supercup|carrera cup)', 'karting', 'kart',
].map((term) => `\\b${term}\\b`).join('|'));

/** Other sports. Always rejected: a celebrity pick or cross-sport story is not F1 news. */
const OTHER_SPORT = new RegExp([
  'nfl', 'nba', 'mlb', 'nhl', 'world series', 'high school', 'football', 'soccer', 'premier league', 'la liga',
  'champions league', 'el clasico', 'real madrid', 'cricket', 't20i?', 'odi', 'ipl', 'rugby', 'red roses', 'tennis',
  'golf', 'boxing', 'ufc', 'baseball', 'basketball', 'ice hockey', 'touchdown', 'scorecard', 'super bowl',
].map((term) => `\\b${term}\\b`).join('|'));

/** Gambling, calculators, streaming/affiliate guides, discussion threads. */
const LOW_VALUE = new RegExp([
  'calculator', 'betting', 'sportsbook', 'bet365', 'parlay', 'promo code', 'odds (?:to|for|on)', 'best bets?',
  'how to watch', 'live stream', 'free stream', 'horoscope', 'coupon', 'daily discussion', 'discussion thread',
].map((term) => `\\b${term}\\b`).join('|'));

/** F1 constructors, the 2026 grid and F1 principals. Refresh when the grid changes. */
const F1_NAME_TERMS = [
  'mclaren', 'ferrari', 'mercedes', 'red bull', 'racing bulls', 'aston martin', 'alpine', 'williams', 'haas', 'sauber',
  'audi', 'cadillac', 'verstappen', 'hamilton', 'leclerc', 'norris', 'piastri', 'russell', 'antonelli', 'alonso',
  'stroll', 'gasly', 'colapinto', 'ocon', 'bearman', 'albon', 'sainz', 'hulkenberg', 'bortoleto', 'lawson',
  'hadjar', 'lindblad', 'perez', 'bottas', 'tsunoda', 'horner', 'wolff', 'vasseur', 'domenicali',
];

/**
 * F1 vocabulary, constructors and the 2026 grid. Used only to admit a story
 * from a multi-series or general outlet; it never labels or ranks anything.
 * A stale name only lowers recall, so refresh it when the grid changes.
 */
const F1_CONTEXT = new RegExp([
  'paddock', 'pit ?lane', 'pole position', 'pole', 'qualifying', 'sprint', 'constructors', "drivers' championship",
  'world champion', 'safety car', 'stewards', 'fia', 'power unit', 'parc ferme', 'grid penalty',
  ...F1_NAME_TERMS,
].map((term) => `\\b${term}\\b`).join('|'));

/**
 * F1 teams, drivers and principals only. Session words (pole, qualifying,
 * sprint, Grand Prix) are shared with MotoGP and other series, so on their
 * own they do not prove a headline is about Formula 1.
 */
const F1_NAMES = new RegExp(F1_NAME_TERMS.map((term) => `\\b${term}\\b`).join('|'));

/** Link path segments that name a series (motorsport.com/f1/..., /motogp/...). */
const F1_PATH_SEGMENT = /^(?:f1|formula-?1|formula-one|formel-?1|formule-?1)$/;
const OTHER_SERIES_PATH_SEGMENT = /^(?:motogp|moto2|moto3|motoe|indycar|indy-nxt|nascar|wec|imsa|le-mans|formula-?e|fe|f2|f3|formula-?2|formula-?3|f1-academy|wrc|rally|supercars|dtm|superbikes?|worldsbk|wsbk|bsb|super-formula|super-gt|btcc|extreme-e|karting|gt-world-challenge|gtwc|porsche-supercup|isle-of-man-tt)$/;

/** Which series a link's path names: 'f1', 'other' or null when it names none. */
export function linkSeries(link: string): 'f1' | 'other' | null {
  try {
    const segments = new URL(link).pathname.toLowerCase().split('/').filter(Boolean);
    if (segments.some((segment) => F1_PATH_SEGMENT.test(segment))) return 'f1';
    if (segments.some((segment) => OTHER_SERIES_PATH_SEGMENT.test(segment))) return 'other';
    return null;
  } catch {
    return null;
  }
}

export interface HeadlineSignals {
  strictF1: boolean;
  grandPrix: boolean;
  context: boolean;
  /** Names an F1 team, current driver or principal. */
  f1Names: boolean;
  otherSeries: boolean;
  otherSport: boolean;
  lowValue: boolean;
}

export function headlineSignals(text: string): HeadlineSignals {
  const folded = fold(text);
  const withoutAcademy = folded.replace(F1_ACADEMY, ' ');
  return {
    strictF1: STRICT_F1.test(withoutAcademy),
    grandPrix: GRAND_PRIX.test(withoutAcademy),
    context: F1_CONTEXT.test(withoutAcademy),
    f1Names: F1_NAMES.test(withoutAcademy),
    otherSeries: OTHER_SERIES.test(folded),
    otherSport: OTHER_SPORT.test(folded),
    lowValue: LOW_VALUE.test(folded),
  };
}

/**
 * Classify one story. Pure and synchronous: safe to run on every render and
 * inside tests with real headlines.
 */
export function classifyNewsItem(item: ClassifiableNewsItem): NewsVerdict {
  if (!item.title?.trim() || !newsHost(item.link)) return { allowed: false, reason: 'invalid-link' };
  if (isBlockedNewsHost(item.link)) return { allowed: false, reason: 'blocked-source' };

  const title = headlineSignals(item.title);
  if (title.otherSport) return { allowed: false, reason: 'other-sport' };
  if (title.lowValue) return { allowed: false, reason: 'low-value' };

  // Category tags count as headline evidence for series (RaceFans tags IndyCar).
  const categories = headlineSignals((item.categories ?? []).join(' · '));
  const namesF1 = title.strictF1 || categories.strictF1;
  if ((title.otherSeries || (categories.otherSeries && !categories.strictF1)) && !title.strictF1) {
    return { allowed: false, reason: 'other-series' };
  }

  const curated = item.provider !== undefined && FEED_CURATED.has(item.provider);
  if (curated) return { allowed: true };

  const publisher = publisherFor(item.link);
  if (!publisher) return { allowed: false, reason: 'unlisted-source' };

  if (publisher.scope === 'f1') return { allowed: true, publisher: publisher.name };
  // A multi-series or general outlet's link path often names the series
  // (motorsport.com/motogp/..., /f1/...). Another series in the path is never F1.
  const series = linkSeries(item.link);
  if (series === 'other' && !title.strictF1) return { allowed: false, reason: 'other-series' };
  // "Grand Prix", pole, qualifying and sprint are MotoGP words too ("Marquez
  // wins Malaysian GP"), so they count only alongside an F1 team or driver name
  // or an F1 section in the link.
  const f1Backed = series === 'f1' || title.f1Names;
  if (publisher.scope === 'motorsport') {
    return namesF1 || series === 'f1' || ((title.grandPrix || title.context) && f1Backed)
      ? { allowed: true, publisher: publisher.name }
      : { allowed: false, reason: 'not-f1' };
  }
  const summary = headlineSignals(item.description ?? '');
  const explicit = title.strictF1 || (title.grandPrix && f1Backed);
  const supported = (summary.strictF1 || (summary.grandPrix && f1Backed)) && title.context && !summary.otherSeries;
  return explicit || supported ? { allowed: true, publisher: publisher.name } : { allowed: false, reason: 'not-f1' };
}

/**
 * Video titles from curated F1 channels. The channel is trusted, so only the
 * other-series and other-sport rules apply (Sky Sports F1 also posts F1
 * Academy highlights, for example).
 */
export function isF1VideoTitle(title: string): boolean {
  const signals = headlineSignals(title);
  if (signals.otherSport || signals.lowValue) return false;
  return !(signals.otherSeries && !signals.strictF1);
}

// ─── Duplicates ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'as', 'with', 'by', 'is', 'are', 'was', 'be', 'after', 'from', 'his', 'her', 'its', 'it', 'that', 'this', 'f1', 'formula', '1', 'gp', 'grand', 'prix']);

function titleTokens(title: string): Set<string> {
  return new Set(fold(title).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((token) => token.length > 1 && !STOPWORDS.has(token)));
}

/** Jaccard overlap of significant headline words. */
export function headlineSimilarity(a: string, b: string): number {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

/** Headlines at or above this overlap within two days are one story. */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;
/**
 * When each headline has words the other lacks (a substitution, not just an
 * added suffix), the overlap must be at least this high: "Norris wins sprint
 * in Austin" and "Norris wins race in Austin" share most words but are two stories.
 */
export const NEAR_DUPLICATE_SUBSTITUTION_THRESHOLD = 0.8;
const NEAR_DUPLICATE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Session words; two headlines about different sessions are different stories. */
const SESSION_TOKENS: Record<string, string> = {
  sprint: 'sprint', shootout: 'sprint-qualifying', race: 'race', grand_prix: 'race',
  qualifying: 'qualifying', quali: 'qualifying', pole: 'qualifying',
  fp1: 'fp1', fp2: 'fp2', fp3: 'fp3', practice: 'practice', testing: 'testing', test: 'testing',
};
/** Venue words (2018-2026 calendars); different venues are different stories. */
const VENUE_TOKENS = new Set([
  'australia', 'australian', 'melbourne', 'china', 'chinese', 'shanghai', 'japan', 'japanese', 'suzuka', 'bahrain', 'sakhir',
  'saudi', 'jeddah', 'miami', 'imola', 'emilia', 'romagna', 'monaco', 'spain', 'spanish', 'barcelona', 'madrid', 'canada',
  'canadian', 'montreal', 'austria', 'austrian', 'spielberg', 'britain', 'british', 'silverstone', 'belgium', 'belgian', 'spa',
  'hungary', 'hungarian', 'budapest', 'netherlands', 'dutch', 'zandvoort', 'italy', 'italian', 'monza', 'azerbaijan', 'baku',
  'singapore', 'austin', 'cota', 'texas', 'mexico', 'mexican', 'brazil', 'brazilian', 'sao', 'paulo', 'interlagos', 'vegas',
  'qatar', 'lusail', 'abu', 'dhabi', 'yas', 'portugal', 'portuguese', 'portimao', 'turkey', 'turkish', 'istanbul', 'russia',
  'russian', 'sochi', 'france', 'french', 'germany', 'german', 'hockenheim', 'tuscan', 'mugello', 'eifel', 'styrian',
]);
const VENUE_ALIASES: Record<string, string> = {
  australian: 'australia', melbourne: 'australia', chinese: 'china', shanghai: 'china', japanese: 'japan', suzuka: 'japan',
  jeddah: 'saudi', imola: 'emilia', romagna: 'emilia', spanish: 'spain', barcelona: 'spain', canadian: 'canada', montreal: 'canada',
  austrian: 'austria', spielberg: 'austria', british: 'britain', silverstone: 'britain', belgian: 'belgium', spa: 'belgium',
  hungarian: 'hungary', budapest: 'hungary', dutch: 'netherlands', zandvoort: 'netherlands', italian: 'italy', monza: 'italy',
  baku: 'azerbaijan', cota: 'austin', texas: 'austin', mexican: 'mexico', brazilian: 'brazil', sao: 'brazil', paulo: 'brazil',
  interlagos: 'brazil', lusail: 'qatar', dhabi: 'abu', yas: 'abu', portuguese: 'portugal', portimao: 'portugal', turkish: 'turkey',
  istanbul: 'turkey', russian: 'russia', sochi: 'russia', french: 'france', german: 'germany', hockenheim: 'germany', mugello: 'tuscan',
};

/** Session, venue and number words: when two headlines disagree on these they are different stories. */
export function headlineDiscriminators(title: string): Set<string> {
  const folded = fold(title)
    .replace(/\bgrands? prix\b|\bgp\b/g, ' grand_prix ')
    .replace(/\b(?:free )?practice (?:one|1)\b/g, ' fp1 ')
    .replace(/\b(?:free )?practice (?:two|2)\b/g, ' fp2 ')
    .replace(/\b(?:free )?practice (?:three|3)\b/g, ' fp3 ')
    .replace(/\bsprint (?:qualifying|shootout|quali)\b/g, ' shootout ')
    .replace(/\bformula (?:1|one)\b|\bf1\b/g, ' ');
  const out = new Set<string>();
  for (const token of folded.replace(/[^\p{L}\p{N}_]+/gu, ' ').split(' ')) {
    if (!token) continue;
    if (SESSION_TOKENS[token]) out.add(`session:${SESSION_TOKENS[token]}`);
    else if (VENUE_TOKENS.has(token)) out.add(`venue:${VENUE_ALIASES[token] ?? token}`);
    else if (/^\d{1,4}$/.test(token)) out.add(`number:${token}`);
  }
  // "race" is implied by a venue's GP name; keep it only when no other session is named.
  if (out.has('session:race') && [...out].some((d) => d.startsWith('session:') && d !== 'session:race')) out.delete('session:race');
  return out;
}

function sameStoryDiscriminators(a: string, b: string): boolean {
  const left = headlineDiscriminators(a);
  const right = headlineDiscriminators(b);
  for (const kind of ['session:', 'venue:', 'number:']) {
    const l = [...left].filter((d) => d.startsWith(kind));
    const r = [...right].filter((d) => d.startsWith(kind));
    // Both name a session (or venue, or number) and they differ: two stories.
    if (l.length && r.length && (l.length !== r.length || l.some((d) => !right.has(d)))) return false;
  }
  return true;
}

/** True when two headlines published close together report the same story. */
export function isNearDuplicateHeadline(a: string, b: string): boolean {
  const similarity = headlineSimilarity(a, b);
  if (similarity < NEAR_DUPLICATE_THRESHOLD) return false;
  if (!sameStoryDiscriminators(a, b)) return false;
  const left = titleTokens(a);
  const right = titleTokens(b);
  const leftOnly = [...left].some((token) => !right.has(token));
  const rightOnly = [...right].some((token) => !left.has(token));
  return leftOnly && rightOnly ? similarity >= NEAR_DUPLICATE_SUBSTITUTION_THRESHOLD : true;
}

export interface DedupableNewsItem {
  title: string;
  link: string;
  pubDateMs: number;
}

/**
 * Drop near-duplicate headlines, keeping the first occurrence. Callers pass
 * rows in priority order (curated feeds before keyword APIs), so the kept copy
 * is the most trusted one.
 */
export function dropNearDuplicates<T extends DedupableNewsItem>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const duplicate = kept.some((other) =>
      Math.abs(other.pubDateMs - item.pubDateMs) <= NEAR_DUPLICATE_WINDOW_MS &&
      isNearDuplicateHeadline(other.title, item.title));
    if (!duplicate) kept.push(item);
  }
  return kept;
}

export interface NewsPolicyReport {
  considered: number;
  kept: number;
  rejected: Partial<Record<NewsRejectReason | 'duplicate', number>>;
}

export function emptyPolicyReport(): NewsPolicyReport {
  return { considered: 0, kept: 0, rejected: {} };
}

/**
 * Apply the policy to rows that each carry their provider. Allowed API rows
 * take the allowlisted publisher's name as their `source`. Rows from a
 * publisher that one of our curated feeds already delivered are dropped: the
 * feed is the canonical copy for that newsroom.
 */
export function applyNewsPolicy<T extends ClassifiableNewsItem & { source: string }>(items: T[], report: NewsPolicyReport = emptyPolicyReport()): T[] {
  const curatedHosts = new Set<string>();
  for (const item of items) {
    if (item.provider && FEED_CURATED.has(item.provider)) {
      const host = newsHost(item.link);
      if (host) curatedHosts.add(host);
    }
  }
  const out: T[] = [];
  for (const item of items) {
    report.considered++;
    const verdict = classifyNewsItem(item);
    if (!verdict.allowed) {
      report.rejected[verdict.reason] = (report.rejected[verdict.reason] ?? 0) + 1;
      continue;
    }
    const curated = item.provider !== undefined && FEED_CURATED.has(item.provider);
    const host = newsHost(item.link);
    if (!curated && host && curatedHosts.has(host)) {
      report.rejected.duplicate = (report.rejected.duplicate ?? 0) + 1;
      continue;
    }
    out.push(verdict.publisher ? { ...item, source: verdict.publisher } : item);
  }
  report.kept += out.length;
  return out;
}
