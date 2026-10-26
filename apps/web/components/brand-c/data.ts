import { openmeteo, mapRaceWeather, raceWeatherDateBounds, type SessionKind } from '@apex/api-client/openmeteo';
import { getCalendar, getGrid, type GridDriver } from '@/lib/grid';
import { getHomeFeed } from '@/lib/home-feed';
import { decodeEntities } from '@/lib/format';
import { circuitPath, getCircuit } from '@/lib/circuits';
import { circuitTimeZone } from '@/lib/circuits/timezones';
import { formatLapLength } from '@/lib/circuits/facts';
import { getChampionship, getHomeWeekend, getLastRace } from '@/components/home/data';
import { RESULT_IN_WINDOW_MS, ageLabel, cleanHeadline, sessionName, sessionStartMs, weekendLadder } from '@/components/home/weekend';
import { uniqueStories } from '@/components/home/stories';
import { getRoundWinners } from '@/components/schedule/data';
import { getF1RacePhoto, type F1Photo } from './f1-photo';

/**
 * Brand C ("Carbon & Light") preview data. Every value is read from the
 * providers the product already uses (calendar, classification, standings,
 * grid media, news wire, forecast) through the request-cached loaders in
 * lib/ and components/home. Nothing is typed in; a missing value is null and
 * the view renders a truthful unavailable state instead.
 */

export interface Figure {
  slug: string;
  code: string;
  firstName: string;
  lastName: string;
  team: string;
  color: string;
  number: number | null;
  /** Transparent full-body cut-out (contain). */
  cutout: string | null;
  /** Transparent head-and-torso crop (contain). */
  torso: string | null;
}

export interface WireItem { title: string; source: string; href: string; publishedMs: number | null; age: string | null; image: string | null }

export interface SessionRow {
  kind: string;
  name: string;
  iso: string;
  startMs: number | null;
  status: 'next' | 'upcoming' | 'classified' | 'started';
  podium: Array<{ code: string; color: string | null }> | null;
  airC: number | null;
  rainPct: number | null;
}

export interface BrandCData {
  now: number;
  phase: 'result' | 'next';
  result: null | {
    raceName: string;
    round: number;
    season: number;
    city: string;
    href: string;
    winner: Figure & { time: string | null };
    podium: Array<Figure & { position: number; time: string | null }>;
    margin: string | null;
    laps: number | null;
    fastest: { name: string; time: string; lap: number } | null;
  };
  next: null | {
    raceName: string;
    round: number;
    season: number;
    circuitName: string;
    circuitId: string;
    place: string;
    href: string;
    timeZone: string | null;
    session: { kind: string; name: string; iso: string } | null;
    raceIso: string;
    sessions: SessionRow[];
    outline: { d: string; width: number; height: number } | null;
    lapLength: string | null;
    weatherSummary: string | null;
    photo: { src: string; credit: string; href: string } | null;
  };
  title: null | { season: number; round: number | null; leader: string; rival: string; gap: number; pointsLeft: number; roundsLeft: number; clinched: boolean };
  standings: Array<Figure & { position: number; points: number; wins: number; gapToLeader: number; headshot: string | null }>;
  wire: WireItem[];
  /** The championship story in one line, written from the published points (never typed in). */
  headline: { text: string; support: string } | null;
  /** Points each driver scored at the last Grand Prix (code -> points), for the tower's third page. */
  lastRacePoints: Record<string, number>;
  lastRaceShort: string | null;
  season: number;
  tiles: SeasonTile[];
  /** Official trackside photograph of the Grand Prix the hero is about (formula1.com, credited), or null. */
  heroPhoto: (F1Photo & { alt: string }) | null;
}

export interface SeasonTile {
  round: number;
  name: string;
  place: string;
  raceIso: string;
  circuitId: string;
  href: string;
  state: 'won' | 'next' | 'upcoming' | 'awaiting';
  winner: { name: string; code: string; team: string; color: string } | null;
}

const shortName = (name: string) => name.replace(/\s+Grand Prix$/i, '');

const torsoOf = (headshot: string | null): string | null => {
  if (!headshot || !headshot.startsWith('https://media.formula1.com/')) return null;
  // Same verified asset, re-cropped by the CDN to head-and-torso (4:5, anchored at the top).
  return headshot.replace(/c_fill,g_north,ar_1:1,w_\d+/, 'c_fill,g_north,ar_4:5,w_640');
};

function figureOf(g: GridDriver | undefined, fallback: { slug: string; firstName: string; lastName: string; team: string; color: string; code?: string }): Figure {
  return {
    slug: fallback.slug,
    code: g?.code || fallback.code || fallback.lastName.slice(0, 3).toUpperCase(),
    firstName: fallback.firstName,
    lastName: fallback.lastName,
    team: fallback.team,
    color: fallback.color || g?.color || '#8d8f98',
    number: g?.number ?? null,
    cutout: g?.cutout ?? null,
    torso: torsoOf(g?.headshot ?? null),
  };
}

const plain = (v?: string | null) => decodeEntities(decodeEntities(v ?? '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function sessionWeather(race: { lat: number; lon: number; raceStartIso: string; sessions: Array<{ kind: string; iso: string }> }, now: number) {
  try {
    const typed = race.sessions.filter((s) => ['FP1', 'FP2', 'FP3', 'SQ', 'S', 'Q', 'R'].includes(s.kind)) as Array<{ kind: SessionKind; iso: string }>;
    const { start, end } = raceWeatherDateBounds(typed, race.raceStartIso);
    const raw = await openmeteo.getRaceWeather({ lat: race.lat, lon: race.lon, dateStart: start, dateEnd: end, revalidate: 3600, now });
    if (!raw) return null;
    const ui = mapRaceWeather({ weather: raw, sessions: typed, raceStartIso: race.raceStartIso });
    return { summary: ui.availability === 'unavailable' ? null : ui.summary, sessions: new Map(ui.sessions.map((s) => [s.kind + s.iso, s])) };
  } catch {
    return null;
  }
}

/** The same verified cut-out at another CDN width (one URL per role, so the photo, its reflection and its light masks share one download). */
export function cutoutAt(url: string | null, width: number): string | null {
  return url ? url.replace(/c_fit,w_\d+/, `c_fit,w_${width}`) : null;
}

export async function loadBrandC(options: { forceNext?: boolean } = {}): Promise<BrandCData> {
  const calendar = await getCalendar();
  const now = calendar.now;
  const [last, champ, grid, feed, weekend, winners] = await Promise.all([
    getLastRace(),
    getChampionship(),
    getGrid().catch((): GridDriver[] => []),
    getHomeFeed().catch(() => []),
    getHomeWeekend(),
    getRoundWinners(calendar.season).catch(() => ({ state: 'unavailable' as const, winners: new Map() })),
  ]);
  const bySlug = new Map(grid.map((d) => [d.slug, d]));
  const byCode = new Map(grid.map((d) => [d.code?.toUpperCase(), d]));

  /* ----------------------------------------------------------- result */
  let result: BrandCData['result'] = null;
  if (last.state === 'available' && last.race && last.podium.length) {
    const race = last.race;
    const podium = last.podium.map((p) => ({ ...figureOf(bySlug.get(p.slug), p), position: p.position, time: p.time }));
    const second = last.results.find((r) => r.position === 2);
    const winnerRow = last.results.find((r) => r.position === 1);
    const fastest = last.results.find((r) => r.fastestLap?.rank === 1);
    result = {
      raceName: decodeEntities(race.name),
      round: race.round,
      season: race.season,
      city: race.city,
      href: `/schedule/${race.season}/${race.routeSlug ?? race.slug}`,
      winner: podium[0]!,
      podium,
      margin: second?.time && /^\+?\d+(\.\d+)?$/.test(second.time) ? second.time.replace(/^\+/, '') : null,
      laps: winnerRow?.laps != null && Number.isFinite(Number(winnerRow.laps)) ? Number(winnerRow.laps) : null,
      fastest: fastest?.fastestLap ? { name: `${decodeEntities(fastest.driver.firstName)} ${decodeEntities(fastest.driver.lastName)}`, time: fastest.fastestLap.time, lap: fastest.fastestLap.lap } : null,
    };
  }
  const raceStart = result && last.race ? sessionStartMs(last.race.raceStartIso) : null;
  const recent = raceStart !== null && now - raceStart < RESULT_IN_WINDOW_MS;

  /* ------------------------------------------------------------- next */
  let next: BrandCData['next'] = null;
  const nr = weekend.race;
  if (nr) {
    const ladder = weekendLadder(nr.sessions, now, weekend.podiums);
    const weather = await sessionWeather(nr, now);
    const upcoming = ladder.find((r) => r.status === 'next') ?? null;
    const geometry = getCircuit(nr.circuitId);
    const showOutline = weekend.facts?.showOutline ?? Boolean(geometry);
    next = {
      raceName: decodeEntities(nr.name),
      round: nr.round,
      season: nr.season,
      circuitName: decodeEntities(nr.circuitName),
      circuitId: nr.circuitId,
      place: [nr.city, nr.country].filter(Boolean).join(', '),
      href: `/schedule/${nr.season}/${nr.routeSlug ?? nr.slug}`,
      timeZone: circuitTimeZone(nr.circuitId),
      session: upcoming ? { kind: upcoming.kind, name: sessionName(upcoming.kind), iso: upcoming.iso } : null,
      raceIso: nr.raceStartIso,
      sessions: ladder.map((row) => {
        const w = weather?.sessions.get(row.kind + row.iso);
        return {
          kind: row.kind,
          name: row.name,
          iso: row.iso,
          startMs: sessionStartMs(row.iso),
          status: row.status,
          podium: row.podium?.map((code) => ({ code, color: weekend.codeColours[code] ?? byCode.get(code)?.color ?? null })) ?? null,
          airC: w?.peakAirTempC ?? null,
          rainPct: w?.precipitationProbabilityPct ?? null,
        };
      }),
      outline: geometry && showOutline ? { d: circuitPath(geometry), width: geometry.width, height: geometry.height } : null,
      lapLength: weekend.facts?.lengthKm != null ? formatLapLength(weekend.facts) : null,
      weatherSummary: weather?.summary ?? null,
      photo: weekend.photo ? {
        src: weekend.photo.src,
        credit: `${weekend.photo.credit.author ?? 'Wikimedia Commons contributor'}${weekend.photo.credit.license ? `, ${weekend.photo.credit.license}` : ''}`,
        href: weekend.photo.credit.sourceUrl,
      } : null,
    };
  }

  /* ------------------------------------------------------- standings */
  const leaderPts = champ.drivers[0]?.points ?? 0;
  const standings = champ.drivers.slice(0, 10).map((d) => {
    const g = bySlug.get(d.slug);
    return {
      ...figureOf(g, { slug: d.slug, firstName: d.firstName, lastName: d.lastName, team: d.team, color: d.color, code: d.code }),
      position: d.position,
      points: d.points,
      wins: d.wins,
      gapToLeader: leaderPts - d.points,
      headshot: g?.headshot ?? null,
    };
  });
  const fight = champ.fight;
  const title = fight && champ.season
    ? { season: champ.season, round: champ.round, leader: fight.leader.name, rival: fight.rival.name, gap: fight.gap, pointsLeft: fight.pointsLeft, roundsLeft: fight.roundsLeft, clinched: fight.clinched }
    : null;

  /* ------------------------------------------------------------ wire */
  const unique = uniqueStories(feed.filter((i) => i.title && i.link).map((item) => ({ item, href: item.link, title: plain(item.title), image: item.imageUrl ?? null })));
  const wire: WireItem[] = unique.slice(0, 8).map(({ item }) => ({
    title: cleanHeadline(plain(item.title), item.source),
    source: item.source,
    href: item.link,
    publishedMs: Number.isFinite(item.pubDateMs) && item.pubDateMs > 0 ? item.pubDateMs : null,
    age: ageLabel(item.pubDateMs, now),
    image: item.imageUrl?.startsWith('https://') ? item.imageUrl : null,
  }));

  /* ------------------------------------------------- championship line */
  let headline: BrandCData['headline'] = null;
  if (fight && champ.season && next) {
    const leader = fight.leader.name;
    const rival = fight.rival.name;
    const short = shortName(next.raceName);
    const p = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
    if (fight.roundsLeft === 0) {
      headline = { text: `${leader}, ${champ.season} champion`, support: `${leader} finished the season ${p(fight.gap)} clear of ${rival}.` };
    } else if (fight.clinched) {
      headline = { text: `${leader}, ${champ.season} champion`, support: `${leader} leads by ${p(fight.gap)} with only ${p(fight.pointsLeft)} left to win.` };
    } else if (fight.decider && fight.decider.round.round === next.round) {
      headline = { text: `Match point in ${short}`, support: `${leader} leads ${rival} by ${p(fight.gap)} with ${p(fight.pointsLeft)} still to win. Leave ${short} more than ${p(fight.decider.leadNeeded)} clear and the ${champ.season} title is settled.` };
    } else if (fight.gap === 0) {
      headline = { text: `Level on points before ${short}`, support: `${leader} and ${rival} are tied with ${p(fight.pointsLeft)} still to win.` };
    } else {
      headline = { text: `${leader} leads by ${fight.gap}`, support: `${leader} leads ${rival} by ${p(fight.gap)} with ${p(fight.pointsLeft)} still to win over ${fight.roundsLeft} rounds.` };
    }
  }
  const lastRacePoints: Record<string, number> = {};
  if (last.state === 'available') for (const r of last.results) if (r.driver.code) lastRacePoints[r.driver.code.toUpperCase()] = r.points;

  /* ------------------------------------------------------ season rail */
  const tiles: SeasonTile[] = calendar.races.map((race) => {
    const w = winners.winners.get(race.round);
    const start = sessionStartMs(race.raceStartIso) ?? Date.parse(race.date);
    const state: SeasonTile['state'] = w ? 'won' : calendar.next?.round === race.round ? 'next' : start <= now ? 'awaiting' : 'upcoming';
    return {
      round: race.round,
      name: decodeEntities(race.name),
      place: decodeEntities(race.city.length <= 14 ? race.city : race.country),
      raceIso: race.raceStartIso,
      circuitId: race.circuitId,
      href: `/schedule/${race.season}/${race.routeSlug ?? race.slug}`,
      state,
      winner: w ? { name: decodeEntities(w.name), code: w.code, team: decodeEntities(w.teamName), color: '#8d8f98' } : null,
    };
  });
  // Team colours from the live grid (the timing feed), the same as everywhere else on the page.
  const colourByTeam = new Map(grid.map((d) => [d.teamSlug, d.color]));
  for (const t of tiles) {
    const w = t.winner ? winners.winners.get(t.round) : null;
    if (t.winner && w) t.winner.color = colourByTeam.get(w.teamSlug) ?? t.winner.color;
  }

  const phase: BrandCData['phase'] = !options.forceNext && result && recent ? 'result' : 'next';
  const photoRace = phase === 'result' && last.race ? last.race : nr;
  const photo = photoRace ? await getF1RacePhoto({ season: photoRace.season, name: photoRace.name, city: photoRace.city, country: photoRace.country }).catch(() => null) : null;
  const heroPhoto = photo && photoRace ? { ...photo, alt: `Trackside at the ${decodeEntities(photoRace.name)}` } : null;
  return {
    heroPhoto,
    now, phase, result, next, title, standings, wire, headline, lastRacePoints,
    lastRaceShort: last.state === 'available' && last.race ? shortName(decodeEntities(last.race.name)) : null,
    season: calendar.season,
    tiles,
  };
}
