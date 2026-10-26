/**
 * One source for the site's navigation, so header, menu, footer and search
 * suggestions never disagree. Season is resolved on the server and passed in.
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface NavSection extends NavLink {
  /** One plain sentence: what you find there. */
  blurb: string;
  links: NavLink[];
  /** Shown in the header bar at desktop widths. */
  primary: boolean;
  /**
   * Rendered with the brand-red accent. Reserved for Give back (/support):
   * the owner's animal-charity page stays in the main navigation and is never
   * demoted (workspace decision, 2026-10-25).
   */
  accent?: boolean;
}

/** Seasons resolved on the server by lib/season.ts (never the clock year). */
export interface NavSeasons {
  /** Exactly the season /schedule shows; null when the calendar could not be read. */
  calendar: number | null;
  /**
   * The season whose standings are published. Results links always point at a
   * real table. null when no provider read confirmed it (Jolpica outage): links
   * then go to the season archive instead of a guessed year (R3-REG-1).
   */
  results: number | null;
}

/** Where "Results" points: the confirmed standings season, else the archive. */
export function resultsHref(season: number | null, table: 'drivers' | 'teams' = 'drivers'): string {
  return season !== null ? `/results/${season}/${table}` : '/results/archive';
}

/** The animal-charity page. Always in the primary navigation (user decision 2026-10-25). */
export const GIVE_BACK_LABEL = 'Give back';

export function navSections(seasons: NavSeasons): NavSection[] {
  const { calendar, results: season } = seasons;
  return [
    { label: 'Latest', href: '/latest', primary: true, blurb: 'The latest Formula 1 stories from trusted newsrooms.', links: [
      { label: 'All stories', href: '/latest' },
      { label: 'Video', href: '/video' },
      { label: 'Newsletter', href: '/newsletter' },
    ] },
    { label: 'Schedule', href: '/schedule', primary: true, blurb: calendar !== null ? `Every round of ${calendar}, in your time zone.` : 'Every round, in your time zone.', links: [
      { label: calendar !== null ? `${calendar} calendar` : 'Race calendar', href: '/schedule' },
      { label: 'Next race', href: '/schedule#next' },
      { label: 'Past seasons', href: '/results/archive' },
    ] },
    { label: 'Results', href: resultsHref(season), primary: true, blurb: 'Standings and classifications, back to 1950.', links: [
      ...(season !== null ? [
        { label: 'Driver standings', href: resultsHref(season, 'drivers') },
        { label: 'Constructor standings', href: resultsHref(season, 'teams') },
      ] : []),
      { label: 'Season archive', href: '/results/archive' },
    ] },
    { label: 'Drivers', href: '/drivers', primary: true, blurb: 'The current grid, every champion and every driver since 1950.', links: [
      { label: 'Current grid', href: '/drivers' },
      { label: 'World champions', href: '/drivers/champions' },
      { label: 'All drivers', href: '/drivers/all' },
    ] },
    { label: 'Teams', href: '/teams', primary: true, blurb: 'Constructors, line-ups and lineage.', links: [
      { label: season !== null ? `${season} teams` : 'Current teams', href: '/teams' },
      { label: 'Constructor champions', href: '/teams/champions' },
      { label: 'All constructors', href: '/teams/all' },
    ] },
    { label: 'Video', href: '/video', primary: true, blurb: 'Highlights and analysis from Formula 1 channels. Plays on YouTube.', links: [
      { label: 'All recent', href: '/video' },
    ] },
    // Realtime timing is out of scope (user decision 2026-10-25): these pages show the latest finished session.
    { label: 'Timing', href: '/live/timing', primary: true, blurb: 'The latest finished session: final classification, race control log and the fastest lap on track.', links: [
      { label: 'Session classification', href: '/live/timing' },
      { label: 'Race control log', href: '/live/race-control' },
      { label: 'Fastest lap on track', href: '/live/track' },
    ] },
    { label: 'Predict', href: '/predict', primary: false, blurb: 'Call the podium before qualifying starts.', links: [
      { label: 'Make a prediction', href: '/predict' },
    ] },
    // Give back (/support) stays in the primary navigation: user decision 2026-10-25. Never remove or demote it.
    { label: GIVE_BACK_LABEL, href: '/support', primary: true, accent: true, blurb: 'Apex is free. If it earned a smile, do one kind thing for an animal near you.', links: [
      { label: 'Help an animal', href: '/support' },
    ] },
  ];
}

/** Season shortcuts offered by search (header overlay and /search). */
export function searchSeasonSuggestions(seasons: NavSeasons): NavLink[] {
  if (seasons.results === null) return [];
  return [
    { label: `${seasons.results} driver standings`, href: `/results/${seasons.results}/drivers` },
    { label: `${seasons.results} constructor standings`, href: `/results/${seasons.results}/teams` },
  ];
}

export const UTILITY_LINKS: NavLink[] = [
  { label: 'Search', href: '/search' },
  { label: 'Newsletter', href: '/newsletter' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

/**
 * Footer index: four short groups. Give back is not repeated here: the footer
 * gives it its own prominent card (user decision 2026-10-25: never demoted).
 */
export function footerGroups(season: number | null): { title: string; links: NavLink[] }[] {
  return [
    { title: 'Race', links: [
      { label: 'Schedule', href: '/schedule' },
      { label: 'Results', href: resultsHref(season) },
      { label: 'Session timing', href: '/live/timing' },
      // Without a confirmed season "Results" already opens the archive: one link, not two with the same href (and React key).
      ...(season !== null ? [{ label: 'Season archive', href: '/results/archive' }] : []),
    ] },
    { title: 'Grid', links: [
      { label: 'Drivers', href: '/drivers' },
      { label: 'Teams', href: '/teams' },
      { label: 'World champions', href: '/drivers/champions' },
      { label: 'Constructor champions', href: '/teams/champions' },
    ] },
    { title: 'Coverage', links: [
      { label: 'Latest', href: '/latest' },
      { label: 'Video', href: '/video' },
      { label: 'Newsletter', href: '/newsletter' },
      { label: 'Predict', href: '/predict' },
    ] },
    { title: 'Apex', links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
      { label: 'Search', href: '/search' },
    ] },
  ];
}

/** The small legal row under the footer: References first, then the policies. */
export function legalLinks(): NavLink[] {
  return [
    { label: 'References', href: '/references' },
    { label: 'Disclaimer', href: '/legal/disclaimer' },
    { label: 'Privacy', href: '/legal/privacy' },
    { label: 'Terms', href: '/legal/terms' },
    { label: 'Copyright', href: '/legal/dmca' },
  ];
}

/** Which primary section a pathname belongs to (for aria-current). */
export function activeSection(sections: NavSection[], pathname: string): string | undefined {
  const first = pathname.split('/')[1] ?? '';
  return sections.find((s) => pathname === s.href || (first && s.href.split('/')[1] === first))?.label;
}

/**
 * Menu and search remember the path they were opened on. Once the route
 * changes away, that memory is dropped, so Back then Forward (or a later visit
 * to the same path) never reopens an overlay by itself (R3-CLICK-1).
 */
export function overlayAfterRoute(openedOn: string | null, pathname: string): string | null {
  return openedOn !== null && openedOn !== pathname ? null : openedOn;
}

/**
 * The only search shortcut: Ctrl/Cmd+K. A bare single-character key (such as
 * "/") could not be turned off or remapped (WCAG 2.1.4).
 */
export function isSearchShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey;
}
