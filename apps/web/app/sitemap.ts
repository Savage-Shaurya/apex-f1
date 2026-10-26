import type { MetadataRoute } from 'next';
import { raceRouteSlug } from '@apex/api-client/jolpica';
import { readSitemapDirectories } from '@/lib/sitemap-directory';
import { siteOrigin } from '@/components/shell/site-metadata';
import { loadSeasonContext } from '@/lib/season';

export const revalidate = 3600;
const CONSTRUCTORS_CHAMPIONSHIP_FROM = 1958;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const SITE = siteOrigin();
  // Seasons come from the real calendar and standings, never the clock year.
  const { activeSeason, resultsSeason, calendarSeason } = await loadSeasonContext();
  const scheduleThrough = Math.max(activeSeason, calendarSeason ?? activeSeason);
  const routes = new Map<string, MetadataRoute.Sitemap[number]>();
  const add = (path: string, priority = 0.6, lastModified?: Date) => {
    const url = `${SITE}${path}`;
    routes.set(url, { url, priority, ...(lastModified && Number.isFinite(lastModified.getTime()) ? { lastModified } : {}) });
  };

  // Existing public pages only. Redirects, account/admin/API paths and query combinations are excluded.
  for (const path of [
    '/', '/schedule', `/results/${resultsSeason}/drivers`, ...(resultsSeason >= CONSTRUCTORS_CHAMPIONSHIP_FROM ? [`/results/${resultsSeason}/teams`] : []), '/results/archive',
    '/drivers', '/drivers/all', '/drivers/champions', '/teams', '/teams/all', '/teams/champions',
    '/latest', '/video', '/newsletter', '/predict', '/live/timing', '/live/race-control', '/live/track',
    // /search is a query tool, not content: it stays out of the sitemap.
    '/about', '/contact', '/support', '/references',
    '/legal/disclaimer', '/legal/privacy', '/legal/terms', '/legal/dmca',
  ]) add(path, path === '/' ? 1 : 0.7);

  // Whole directories are fetched once, never one upstream request per profile.
  // A failed directory read, race history included, throws (ISR keeps the last
  // complete sitemap rather than caching one without ~1,100 race pages).
  const { drivers, teams, calendar, seasons, history } = await readSitemapDirectories();

  if (drivers.status === 'fulfilled') for (const driver of drivers.value) {
    if (!/^[a-zA-Z0-9_-]+$/.test(driver.driverId)) continue;
    add(`/drivers/${driver.driverId}`);
    add(`/drivers/${driver.driverId}/career`, 0.5);
  }
  if (teams.status === 'fulfilled') for (const team of teams.value) {
    if (!/^[a-zA-Z0-9_-]+$/.test(team.constructorId)) continue;
    add(`/teams/${team.constructorId}`);
    add(`/teams/${team.constructorId}/history`, 0.5);
  }
  if (seasons.status === 'fulfilled') for (const record of seasons.value) {
    const year = Number(record.season);
    if (!Number.isInteger(year) || year < 1950 || year > scheduleThrough) continue;
    add(`/schedule/${year}`, 0.5);
    // Standings pages exist only up to the live standings season.
    if (year > resultsSeason) continue;
    add(`/results/${year}/drivers`, 0.5);
    // The Constructors' Championship began in 1958; earlier seasons have no table.
    if (year >= CONSTRUCTORS_CHAMPIONSHIP_FROM) add(`/results/${year}/teams`, 0.5);
  }
  if (history.status === 'fulfilled') for (const race of history.value) {
    const year = Number(race.season);
    const round = Number(race.round);
    const slug = race.Circuit?.circuitId;
    if (!Number.isInteger(year) || year < 1950 || year > scheduleThrough || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(slug) || !Number.isSafeInteger(round) || round < 1) continue;
    add(`/schedule/${year}/${raceRouteSlug(slug, round)}`, 0.4);
  }
  if (calendar.status === 'fulfilled') for (const record of calendar.value) {
    // Metadata needs route identity; missing location/weather must not erase unrelated URLs.
    const year = Number(record.season);
    const slug = record.Circuit?.circuitId;
    const round = Number(record.round);
    if (!Number.isInteger(year) || year < 1950 || year > scheduleThrough + 1 || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(slug) || !Number.isSafeInteger(round) || round < 1) continue;
    add(`/schedule/${year}`, 0.7);
    add(`/schedule/${year}/${raceRouteSlug(slug, round)}`);
  }
  // Every public original is covered by the bounded maps in /sitemap-index.xml.

  return [...routes.values()];
}
