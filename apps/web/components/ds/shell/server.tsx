import { getShellCalendar } from '@/lib/grid';
import { getHomeFeed } from '@/lib/home-feed';
import { getShellSeasonContext } from '@/lib/season';
import { decodeEntities, shortRaceName } from '@/lib/format';
import { BRAND_STATEMENT } from '@/lib/credits';
import { SiteHeader, type HeaderFacts } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import type { MenuLead, MenuNextRace } from './SiteMenu';

/**
 * Server wrappers for the shell. They read the request's cached calendar,
 * standings season and news feed (lib/grid, lib/season, lib/home-feed), so
 * the header and footer add no provider requests of their own.
 */

/**
 * Header facts: the seasons for every link, the next race for the countdown chip, the top story for the menu.
 * Not awaited here: the bar renders in the first HTML and only the parts that need these facts stream in
 * (SiteHeader), so the header is never swapped in after load.
 */
export function SiteHeaderServer() {
  // A failed read leaves the header in its outage state (archive links, no chip), never an error page.
  return <SiteHeader facts={headerFacts().catch((): HeaderFacts => ({ seasons: { calendar: null, results: null }, nextRace: null, lead: null }))} />;
}

async function headerFacts(): Promise<HeaderFacts> {
  const [calendar, seasons, feed] = await Promise.all([
    // Shell reads: an outage must not make every route dynamic (see lib/grid).
    getShellCalendar(),
    getShellSeasonContext(),
    getHomeFeed().catch(() => []),
  ]);
  const n = calendar.next;
  const nextRace: MenuNextRace | null = n
    ? { round: n.round, name: shortRaceName(n.name), country: n.country, href: `/schedule/${n.season}/${n.routeSlug ?? n.slug}`, startIso: n.raceStartIso }
    : null;
  const top = feed[0];
  const lead: MenuLead | null = top ? { title: decodeEntities(top.title), source: top.source, href: top.link } : null;
  // An unconfirmed season (Jolpica outage) never becomes a guessed link (R3-REG-1).
  return { seasons: { calendar: seasons.calendarSeason, results: seasons.resultsSeasonConfirmed ? seasons.resultsSeason : null }, nextRace, lead };
}

/** Footer: results links follow the live standings season; the brand and non-affiliation lines come from lib/credits.ts (full credits: /references). */
export async function SiteFooterServer() {
  const { resultsSeason, resultsSeasonConfirmed } = await getShellSeasonContext();
  return (
    <SiteFooter
      season={resultsSeasonConfirmed ? resultsSeason : null}
      statement={BRAND_STATEMENT}
    />
  );
}
