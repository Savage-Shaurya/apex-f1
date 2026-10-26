import { isRankedStanding, jolpica, mapConstructor, mapConstructorStanding, mapDriver, mapDriverStanding, type UiConstructorStanding, type UiDriverStanding } from '@apex/api-client/jolpica';
import { cleanName } from '@/components/drivers/people';
import { readConstructorIdentity, readCurrentStandings, readDriverIdentity, readPublicSport, SPORT_READ_OPTIONS } from '@/lib/public-sport';
import { loadRaceCalendar, loadRaceResults } from '@/lib/race-detail';
import type { OgCardData, OgStat } from './card';

/**
 * Real data for each page type's share card (final audit F-04). Each reader
 * uses the same provider reads (and caches) as its page and never throws: a
 * failed or slow read leaves the figures off and keeps the page's own title,
 * so a share image is never wrong and never an error.
 */

/** A card read gets this long before it falls back (crawlers wait about ten seconds). */
const CARD_BUDGET_MS = 7_000;

export async function safeCard(read: () => Promise<OgCardData>, fallback: OgCardData): Promise<OgCardData> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<OgCardData>((resolve) => { timer = setTimeout(() => resolve(fallback), CARD_BUDGET_MS); }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const SLUG = /^[a-zA-Z0-9_-]{1,160}$/;
const points = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const place = (n: number | null) => (n ? `P${n}` : '–');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

async function currentDriverTable(): Promise<{ season: number | null; round: number | null; rows: Array<UiDriverStanding & { position: number }> } | null> {
  const read = await readCurrentStandings(jolpica.getDriverStandingsSnapshot);
  if (read.state !== 'available' || !read.snapshot) return null;
  return { season: read.snapshot.season ? Number(read.snapshot.season) : null, round: read.snapshot.round, rows: read.snapshot.standings.map(mapDriverStanding).filter(isRankedStanding) };
}

async function currentConstructorTable(): Promise<{ season: number | null; round: number | null; rows: Array<UiConstructorStanding & { position: number }> } | null> {
  const read = await readCurrentStandings(jolpica.getConstructorStandingsSnapshot);
  if (read.state !== 'available' || !read.snapshot) return null;
  return { season: read.snapshot.season ? Number(read.snapshot.season) : null, round: read.snapshot.round, rows: read.snapshot.standings.map(mapConstructorStanding).filter(isRankedStanding) };
}

/* ------------------------------------------------------------- drivers */

export function driverCard(slug: string, view: 'profile' | 'career'): Promise<OgCardData> {
  const fallback: OgCardData = { kicker: view === 'career' ? 'Driver · every Grand Prix' : 'Formula 1 driver', title: 'Driver profile' };
  if (!SLUG.test(slug)) return Promise.resolve(fallback);
  return safeCard(async () => {
    const [identity, table] = await Promise.all([readDriverIdentity(slug, jolpica, { attempts: 1 }), currentDriverTable().catch(() => null)]);
    if (identity.state !== 'found') return fallback;
    const d = mapDriver(identity.raw);
    const row = table?.rows.find((r) => r.driver.slug === d.slug) ?? null;
    const born = /^\d{4}/.test(d.dob) ? `born ${d.dob.slice(0, 4)}` : null;
    const team = row ? cleanName(row.constructorName) : null;
    const kicker = view === 'career'
      ? 'Career · every Grand Prix'
      : ['Driver', team, row && d.number ? `No. ${d.number}` : null].filter(Boolean).join(' · ');
    const stats: OgStat[] = row && table?.season
      ? [{ label: `${table.season} position`, value: place(row.position) }, { label: 'Points', value: points(row.points) }, { label: 'Wins', value: String(row.wins) }]
      : [];
    return { kicker, title: d.fullName, subtitle: [d.nationality !== 'Unknown' ? d.nationality : null, born].filter(Boolean).join(' · ') || null, stats };
  }, fallback);
}

export function driversIndexCard(): Promise<OgCardData> {
  const fallback: OgCardData = { kicker: 'The grid', title: 'Formula 1 drivers', subtitle: 'Every driver on the current grid, and every driver since 1950.' };
  return safeCard(async () => {
    const table = await currentDriverTable();
    if (!table?.rows.length) return fallback;
    const leader = table.rows[0]!;
    const teams = new Set(table.rows.map((r) => r.constructorSlug)).size;
    return {
      kicker: `${table.season ?? ''} grid${table.round ? ` · after round ${table.round}` : ''}`.trim(),
      title: 'Formula 1 drivers',
      subtitle: 'Every driver on the current grid, and every driver since 1950.',
      stats: [{ label: 'Leader', value: leader.driver.lastName }, { label: 'Points', value: points(leader.points) }, { label: 'Drivers', value: String(table.rows.length) }, { label: 'Teams', value: String(teams) }],
    };
  }, fallback);
}

/* --------------------------------------------------------------- teams */

export function teamCard(slug: string, view: 'profile' | 'history'): Promise<OgCardData> {
  const fallback: OgCardData = { kicker: view === 'history' ? "Team · constructors' championship history" : 'Formula 1 team', title: 'Team profile' };
  if (!SLUG.test(slug)) return Promise.resolve(fallback);
  return safeCard(async () => {
    const [identity, teams, drivers] = await Promise.all([
      readConstructorIdentity(slug, jolpica, { attempts: 1 }),
      currentConstructorTable().catch(() => null),
      currentDriverTable().catch(() => null),
    ]);
    if (identity.state !== 'found') return fallback;
    const c = mapConstructor(identity.raw);
    const name = cleanName(c.name);
    const row = teams?.rows.find((r) => r.constructor.slug === c.slug) ?? null;
    const lineup = (drivers?.rows ?? []).filter((r) => r.constructorSlug === c.slug).map((r) => r.driver.lastName);
    const stats: OgStat[] = row && teams?.season
      ? [{ label: `${teams.season} position`, value: place(row.position) }, { label: 'Points', value: points(row.points) }, { label: 'Wins', value: String(row.wins) }]
      : [];
    return {
      kicker: view === 'history' ? "Team history · constructors' championship" : `Team${c.nationality !== 'Unknown' ? ` · ${c.nationality}` : ''}`,
      title: name,
      subtitle: lineup.length ? `${teams?.season ?? ''} drivers: ${lineup.join(', ')}`.trim() : null,
      stats,
    };
  }, fallback);
}

export function teamsIndexCard(): Promise<OgCardData> {
  const fallback: OgCardData = { kicker: 'The grid', title: 'Formula 1 teams', subtitle: 'Every team on the current grid, and every constructor since 1950.' };
  return safeCard(async () => {
    const table = await currentConstructorTable();
    if (!table?.rows.length) return fallback;
    const leader = table.rows[0]!;
    return {
      kicker: `${table.season ?? ''} constructors${table.round ? ` · after round ${table.round}` : ''}`.trim(),
      title: 'Formula 1 teams',
      subtitle: 'Every team on the current grid, and every constructor since 1950.',
      stats: [{ label: 'Leader', value: cleanName(leader.constructor.name) }, { label: 'Points', value: points(leader.points) }, { label: 'Teams', value: String(table.rows.length) }],
    };
  }, fallback);
}

/* --------------------------------------------------------------- races */

export function raceCard(seasonParam: string, key: string, now = Date.now()): Promise<OgCardData> {
  const season = Number(seasonParam);
  const fallback: OgCardData = { kicker: Number.isInteger(season) ? `${season} season` : 'Grand Prix', title: 'Grand Prix weekend' };
  return safeCard(async () => {
    const calendar = await loadRaceCalendar(season, key);
    if (calendar.state !== 'found') return fallback;
    const r = calendar.race;
    const card: OgCardData = {
      kicker: `Round ${r.round} · ${r.season}`,
      title: r.name,
      subtitle: [r.circuitName, [r.city, r.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    };
    const start = Date.parse(r.raceStartIso);
    if (Number.isFinite(start) && start < now) {
      const results = await loadRaceResults(r, jolpica, now).catch(() => ({ state: 'unavailable' as const }));
      if (results.state === 'available' && results.results.length >= 3) {
        const podium = [...results.results].sort((a, b) => a.position - b.position).slice(0, 3);
        return { ...card, stats: podium.map((p, i) => ({ label: ['Winner', 'Second', 'Third'][i]!, value: p.driver.lastName })) };
      }
      return card;
    }
    return Number.isFinite(start)
      ? { ...card, stats: [{ label: 'Race (UTC)', value: `${day(r.raceStartIso)} ${r.raceStartIso.slice(11, 16)}` }, { label: 'Sessions', value: String(r.sessions.length) }] }
      : card;
  }, fallback);
}

export function calendarCard(seasonParam: string | null, now = Date.now()): Promise<OgCardData> {
  const season = seasonParam === null ? null : Number(seasonParam);
  const fallback: OgCardData = { kicker: 'Schedule', title: season ? `${season} calendar` : 'Formula 1 calendar' };
  return safeCard(async () => {
    const read = await readPublicSport(() => jolpica.getSchedule(season ?? 'current', { ...SPORT_READ_OPTIONS, revalidate: 3600 }));
    if (read.state !== 'available' || !read.data.length) return fallback;
    const races = read.data;
    const year = Number(races[0]!.season);
    const iso = (r: (typeof races)[number]) => `${r.date}T${r.time ?? '00:00:00Z'}`;
    const next = races.find((r) => Date.parse(iso(r)) > now);
    return {
      kicker: `Schedule · ${year}`,
      title: `${year} calendar`,
      subtitle: next ? `Next: ${next.raceName} · ${day(iso(next))}` : 'Every round, session and winner.',
      stats: [{ label: 'Rounds', value: String(races.length) }, { label: 'Opens', value: day(iso(races[0]!)) }, { label: 'Closes', value: day(iso(races.at(-1)!)) }],
    };
  }, fallback);
}

/* ----------------------------------------------------------- standings */

export function standingsCard(seasonParam: string, kind: 'drivers' | 'teams'): Promise<OgCardData> {
  const season = Number(seasonParam);
  const label = kind === 'drivers' ? "Drivers' championship" : "Constructors' championship";
  const fallback: OgCardData = { kicker: 'Standings', title: Number.isInteger(season) ? `${season} ${label}` : label };
  if (!Number.isInteger(season) || season < 1950) return Promise.resolve(fallback);
  return safeCard(async () => {
    const opts = { ...SPORT_READ_OPTIONS, revalidate: 600 };
    if (kind === 'drivers') {
      const read = await readPublicSport(() => jolpica.getDriverStandingsSnapshot(season, opts));
      if (read.state !== 'available') return fallback;
      const rows = read.data.standings.map(mapDriverStanding).filter(isRankedStanding).slice(0, 3);
      if (!rows.length) return fallback;
      return { kicker: `Standings · ${read.data.round ? `after round ${read.data.round}` : season}`, title: `${season} ${label}`, stats: rows.map((r) => ({ label: `P${r.position} · ${r.driver.lastName}`, value: `${points(r.points)} pts` })) };
    }
    const read = await readPublicSport(() => jolpica.getConstructorStandingsSnapshot(season, opts));
    if (read.state !== 'available') return fallback;
    const rows = read.data.standings.map(mapConstructorStanding).filter(isRankedStanding).slice(0, 3);
    if (!rows.length) return fallback;
    return { kicker: `Standings · ${read.data.round ? `after round ${read.data.round}` : season}`, title: `${season} ${label}`, stats: rows.map((r) => ({ label: `P${r.position} · ${cleanName(r.constructor.name)}`, value: `${points(r.points)} pts` })) };
  }, fallback);
}
