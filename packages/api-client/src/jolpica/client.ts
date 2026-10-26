import type {
  JolpicaEnvelope, JolpicaRaceTableEnvelope, JolpicaDriverStandingsEnvelope,
  JolpicaConstructorStandingsEnvelope, JolpicaDriverListEnvelope,
  JolpicaConstructorListEnvelope, JolpicaResultsEnvelope, JolpicaSprintEnvelope,
  JolpicaQualifyingEnvelope, JolpicaPitStopsEnvelope, JolpicaLapsEnvelope,
  JolpicaLapEntry, JolpicaRace,
} from './types';
import { ProviderError, failOr, isRecord, requestJson, untrackedFetch } from '../transport';
import { jolpicaRequestControl } from './request-control';
import { resolveProviderBase } from '../provider-base';
import { APEX_USER_AGENT } from '../user-agent';
import { BUILD_QUEUE_ALLOWANCE_MS, BUILD_READ_ATTEMPTS, buildRetryDelayMs, isBuildPhase, providerReadBudget } from '../build-phase';
import { orderConstructorsByLatestRace, teamStints, type TeamStint } from './team-stints';

/** Overridable only for local development (loopback, non-deployment), where
 * scripts/dev/provider-cache.mjs fronts Jolpica with a shared real-response cache. */
const PROVIDER_BASE = resolveProviderBase('JOLPICA_BASE_URL', 'https://api.jolpi.ca/ergast/f1');
const BASE = PROVIDER_BASE.base;
/** The resolved Jolpica base URL (cache keys are full URLs under it). */
export const JOLPICA_BASE = BASE;
/** True when a loopback development cache stands in for Jolpica. */
export const JOLPICA_BASE_OVERRIDDEN = PROVIDER_BASE.overridden;
export interface FetchOpts {
  /** Lifetime of validated process-cache entries. Raw provider responses are never persisted by Next. */
  revalidate?: number;
  fetchImpl?: typeof fetch;
  /** Strict ingestion rejects failures/incomplete collections. Render default is fail-soft. */
  strict?: boolean;
  /** Request a new paced observation rather than join an earlier render's read. revalidate:0 does this automatically. */
  fresh?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Absolute budget for the whole paginated operation, including retries. */
  deadlineMs?: number;
  limit?: number;
  offset?: number;
}
async function safe<T>(opts: FetchOpts, fallback: T, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { return failOr('jolpica', error, opts.strict, fallback); }
}
function slug(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new ProviderError('jolpica', 'invalid-input');
  return value;
}
function encodedPath(path: string): string {
  if (path.split('/').some(part => !/^[a-zA-Z0-9_-]+(?:\.json)?$/.test(part))) throw new ProviderError('jolpica', 'invalid-input');
  return path.split('/').map(encodeURIComponent).join('/');
}
function nonnegativeInteger(value: unknown): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') throw new ProviderError('jolpica', 'invalid-response');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new ProviderError('jolpica', 'invalid-response');
  return number;
}
function budget(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(value!, maximum)) : fallback;
}
/** Failures worth another build-time attempt: the provider may answer on the next try. */
function buildRetryable(error: unknown): error is ProviderError {
  return error instanceof ProviderError && (error.code === 'network' || error.code === 'timeout' || error.code === 'rate-limit'
    || (error.code === 'http' && (error.status === 429 || (error.status !== undefined && error.status >= 500))));
}
async function get<T>(path: string, opts: FetchOpts, validate?: (env: JolpicaEnvelope<T>) => void): Promise<JolpicaEnvelope<T>> {
  const url = new URL(`${BASE}/${encodedPath(path)}`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(100, opts.limit ?? 100))));
  url.searchParams.set('offset', String(opts.offset ?? 0));
  // The transport timeout measures Jolpica itself. During `next build` a read
  // may additionally wait in the request queue for a bounded allowance, and is
  // retried with backoff inside it (F-01); at runtime the queue counts against
  // the same timeout, so a visitor never waits longer than before.
  const building = isBuildPhase();
  const { transportMs: transport, totalMs } = providerReadBudget(budget(opts.timeoutMs, 8_000, 30_000), building);
  const expires = Date.now() + totalMs;
  const attempts = building ? BUILD_READ_ATTEMPTS : 2;
  for (let attempt = 0; ; attempt++) {
    try {
      const fetchAndValidate = async (signal?: AbortSignal) => {
        const raw = await requestJson<unknown>('jolpica', url, {
          headers: { Accept: 'application/json', 'User-Agent': APEX_USER_AGENT },
          // Next's Data Cache stores HTTP200 bodies before this schema/identity
          // check. The raw transport bypasses Next's fetch instrumentation, so
          // it is neither persisted nor able to force a dynamic render; the
          // page's ISR window and readThrough's validated cache govern reuse.
          cache: 'no-store',
        } as RequestInit, { ...opts, fetchImpl: opts.fetchImpl ?? untrackedFetch(), signal: signal ?? opts.signal, timeoutMs: Math.max(1, Math.min(transport, expires - Date.now())) });
        if (!isRecord(raw) || !isRecord(raw.MRData)) throw new ProviderError('jolpica', 'invalid-response');
        nonnegativeInteger(raw.MRData.total);
        nonnegativeInteger(raw.MRData.offset);
        const limit = nonnegativeInteger(raw.MRData.limit);
        if (!limit || limit > 100) throw new ProviderError('jolpica', 'invalid-response');
        const env = raw as unknown as JolpicaEnvelope<T>;
        validate?.(env);
        return env;
      };
      // Injected transports are isolated test/tool callers, never shared with production cache.
      return opts.fetchImpl ? await fetchAndValidate() : await jolpicaRequestControl.readThrough(
        url.toString(), opts.revalidate ?? 300, { ...opts, retryAttempt: attempt > 0, timeoutMs: Math.max(1, expires - Date.now()) }, fetchAndValidate,
      );
    } catch (error) {
      // At runtime: one retry, only for a dropped connection or a gateway
      // error. A 429 or a 503 (overloaded) is not amplified; the request
      // controller remembers the failure and serves the last validated copy.
      // During the build: bounded retries with backoff for any transient
      // failure, honouring Retry-After, all inside the read's budget.
      const retryable = building
        ? buildRetryable(error)
        : error instanceof ProviderError && (error.code === 'network' || (error.code === 'http' && (error.status === 502 || error.status === 504)));
      const wait = building
        ? Math.max(buildRetryDelayMs(attempt + 1), error instanceof ProviderError ? error.retryAfterMs ?? 0 : 0)
        : 250 * 2 ** attempt;
      if (!retryable || attempt + 1 >= attempts || Date.now() + wait + (building ? 1_000 : 0) >= expires || opts.signal?.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
}
/** Jolpica serialises a missing car number (some withdrawn entries, e.g. Bordeu 1961 French GP) as "None". */
function withoutNoneNumbers<T>(value: T): T {
  if (Array.isArray(value)) for (const entry of value) if (isRecord(entry) && entry.number === 'None') delete entry.number;
  return value;
}
/** Jolpica still stores many Wikipedia links as http://; links and JSON-LD sameAs must be https. */
export function secureWikipediaUrl<T>(value: T): T {
  return (typeof value === 'string' ? value.replace(/^http:\/\/((?:[a-z0-9-]+\.)*wikipedia\.org)(?=[/?#]|$)/i, 'https://$1') : value) as T;
}
function rows<T>(value: unknown, requiredStrings: string[] = [], requiredObjects: string[] = []): T[] {
  if (!Array.isArray(value) || value.some(item => !isRecord(item))) throw new ProviderError('jolpica', 'invalid-response');
  for (const item of value as Record<string, unknown>[]) {
    if (requiredStrings.some(key => typeof item[key] !== 'string' || !(item[key] as string).trim()) || requiredObjects.some(key => !isRecord(item[key]))) throw new ProviderError('jolpica', 'invalid-response');
    if (Object.keys(item).length === 0) throw new ProviderError('jolpica', 'invalid-response');
    if (typeof item.url === 'string') item.url = secureWikipediaUrl(item.url);
    if (isRecord(item.Circuit) && typeof item.Circuit.url === 'string') item.Circuit.url = secureWikipediaUrl(item.Circuit.url);
    for (const key of ['season','round','position','points','wins','grid','laps','stop','number']) {
      if (item[key] !== undefined && (typeof item[key] !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(item[key]) || !Number.isFinite(Number(item[key])))) throw new ProviderError('jolpica', 'invalid-response');
    }
    for (const key of ['season','round','position','wins','grid','laps','stop','number']) if (item[key] !== undefined && (!Number.isSafeInteger(Number(item[key])) || Number(item[key]) < 0)) throw new ProviderError('jolpica', 'invalid-response');
    if (item.season !== undefined && (Number(item.season) < 1950 || Number(item.season) > new Date().getUTCFullYear() + 1)) throw new ProviderError('jolpica', 'invalid-response');
    for (const key of ['url','nationality','dateOfBirth','permanentNumber','code','status','date','time','duration','driverId','positionText']) if (item[key] !== undefined && typeof item[key] !== 'string') throw new ProviderError('jolpica', 'invalid-response');
    if ('Driver' in item && (!isRecord(item.Driver) || typeof item.Driver.driverId !== 'string' || typeof item.Driver.givenName !== 'string' || typeof item.Driver.familyName !== 'string')) throw new ProviderError('jolpica', 'invalid-response');
    if ('Driver' in item) rows([item.Driver], ['driverId','givenName','familyName']);
    if ('Constructor' in item) rows([item.Constructor], ['constructorId','name']);
    if ('Constructors' in item) rows(item.Constructors, ['constructorId','name']);
    if ('wins' in item && 'Driver' in item && !Array.isArray(item.Constructors)) throw new ProviderError('jolpica', 'invalid-response');
    if ('constructorId' in item && (typeof item.constructorId !== 'string' || typeof item.name !== 'string')) throw new ProviderError('jolpica', 'invalid-response');
    if ('givenName' in item && (typeof item.driverId !== 'string' || typeof item.givenName !== 'string' || typeof item.familyName !== 'string')) throw new ProviderError('jolpica', 'invalid-response');
    for (const key of ['driverId', 'constructorId']) if (item[key] !== undefined && (typeof item[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item[key] as string))) throw new ProviderError('jolpica', 'invalid-response');
    if ('date' in item) {
      if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0, 10) !== item.date) throw new ProviderError('jolpica', 'invalid-response');
      if (item.time !== undefined && (typeof item.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z)?$/.test(item.time))) throw new ProviderError('jolpica', 'invalid-response');
    }
    for (const key of ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'Qualifying', 'Sprint', 'SprintQualifying']) if (item[key] !== undefined) rows([item[key]], ['date']);
    if ('raceName' in item && (typeof item.season !== 'string' || typeof item.round !== 'string' || !isRecord(item.Circuit))) throw new ProviderError('jolpica', 'invalid-response');
    if ('Time' in item && (!isRecord(item.Time) || typeof item.Time.time !== 'string')) throw new ProviderError('jolpica', 'invalid-response');
    if ('FastestLap' in item) {
      const fastest = item.FastestLap;
      if (!isRecord(fastest) || typeof fastest.rank !== 'string' || !/^\d+$/.test(fastest.rank) || typeof fastest.lap !== 'string' || !/^\d+$/.test(fastest.lap) || !isRecord(fastest.Time) || typeof fastest.Time.time !== 'string') throw new ProviderError('jolpica', 'invalid-response');
    }
    if ('Circuit' in item) {
      const circuit = item.Circuit;
      if (!isRecord(circuit) || typeof circuit.circuitId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(circuit.circuitId) || typeof circuit.circuitName !== 'string' || !circuit.circuitName.trim() || !isRecord(circuit.Location) || typeof circuit.Location.country !== 'string' || typeof circuit.Location.locality !== 'string' || typeof circuit.Location.lat !== 'string' || typeof circuit.Location.long !== 'string' || !Number.isFinite(Number(circuit.Location.lat)) || !Number.isFinite(Number(circuit.Location.long)) || Math.abs(Number(circuit.Location.lat)) > 90 || Math.abs(Number(circuit.Location.long)) > 180) throw new ProviderError('jolpica', 'invalid-response');
    }
  }
  return value as T[];
}
/** Pages fetched at once after the first page reveals the total. The request
 * controller still paces starts 260 ms apart. */
const PAGE_CONCURRENCY = 3;
/** Metadata counts leaf records, not nested race/lap groups. No partial data escapes. */
async function pages<E, R>(path: string, opts: FetchOpts, select: (env: JolpicaEnvelope<E>) => R[], count: (records: R[]) => number = records => records.length): Promise<JolpicaEnvelope<E>[]> {
  // The whole paginated read may also wait in the build queue (F-01).
  const expires = Date.now() + budget(opts.deadlineMs, 30_000, 120_000) + (isBuildPhase() ? BUILD_QUEUE_ALLOWANCE_MS : 0);
  const fetchPage = async (offset: number, expectedTotal: number | undefined, expectedLimit: number | undefined) => {
    const remaining = expires - Date.now();
    if (remaining <= 0) throw new ProviderError('jolpica', 'timeout');
    const check = (candidate: JolpicaEnvelope<E>) => {
      const candidateTotal = nonnegativeInteger(candidate.MRData.total);
      const candidateOffset = nonnegativeInteger(candidate.MRData.offset);
      const candidateLimit = nonnegativeInteger(candidate.MRData.limit);
      if (candidateOffset !== offset || (expectedTotal !== undefined && expectedTotal !== candidateTotal) || (expectedLimit !== undefined && expectedLimit !== candidateLimit) || candidateTotal > 100_000 || count(select(candidate)) !== Math.min(candidateLimit, Math.max(0, candidateTotal - offset))) throw new ProviderError('jolpica', 'incomplete');
    };
    const env = await get<E>(path, { ...opts, offset, limit: 100, timeoutMs: Math.min(budget(opts.timeoutMs, 8_000, 30_000), remaining) }, check);
    check(env);
    return env;
  };
  const first = await fetchPage(0, undefined, undefined);
  const total = nonnegativeInteger(first.MRData.total);
  const limit = nonnegativeInteger(first.MRData.limit);
  const firstLength = count(select(first));
  if (firstLength >= total) return [first];
  if (!firstLength || firstLength !== limit) throw new ProviderError('jolpica', 'incomplete');
  const offsets: number[] = [];
  for (let offset = firstLength; offset < total; offset += limit) offsets.push(offset);
  if (offsets.length >= 1000) throw new ProviderError('jolpica', 'incomplete');
  const rest = new Array<JolpicaEnvelope<E>>(offsets.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= offsets.length) return;
      rest[index] = await fetchPage(offsets[index]!, total, limit);
    }
  }));
  return [first, ...rest];
}
async function flat<E, R>(path: string, opts: FetchOpts, select: (env: JolpicaEnvelope<E>) => R[]): Promise<R[]> {
  return (await pages(path, opts, select)).flatMap(select);
}
interface RaceIdentity { season: number; round: number }
function validSeason(season: number | 'current'): void {
  if (season !== 'current' && (!Number.isSafeInteger(season) || season < 1950 || season > new Date().getUTCFullYear() + 1)) throw new ProviderError('jolpica', 'invalid-input');
}
function tableIdentity(table: unknown, expected: Record<string, string | number>): void {
  if (!isRecord(table)) throw new ProviderError('jolpica', 'invalid-response');
  for (const [key, value] of Object.entries(expected)) {
    if (table[key] !== undefined && String(table[key]) !== String(value)) throw new ProviderError('jolpica', 'invalid-response');
  }
}
function distinct<T>(records: T[], key: (record: T) => string): T[] {
  if (new Set(records.map(key)).size !== records.length) throw new ProviderError('jolpica', 'incomplete');
  return records;
}
function requestedRace(season: number, round: number): RaceIdentity {
  if (!Number.isSafeInteger(season) || season < 1950 || season > new Date().getUTCFullYear() + 1 || !Number.isSafeInteger(round) || round < 1) throw new ProviderError('jolpica', 'invalid-input');
  return { season, round };
}
/** Validate every page before flattening discards its race identity. Empty future datasets remain valid. */
function raceRows<T extends { season: string; round: string }>(env: { MRData: unknown }, expected: RaceIdentity): T[] {
  if (!isRecord(env.MRData) || !isRecord(env.MRData.RaceTable)) throw new ProviderError('jolpica', 'invalid-response');
  const table = env.MRData.RaceTable;
  for (const key of ['season', 'round'] as const) {
    if (table[key] !== undefined && nonnegativeInteger(table[key]) !== expected[key]) throw new ProviderError('jolpica', 'invalid-response');
  }
  const races = rows<T>(table.Races, ['season', 'round']);
  if (races.some(race => nonnegativeInteger(race.season) !== expected.season || nonnegativeInteger(race.round) !== expected.round)) throw new ProviderError('jolpica', 'invalid-response');
  return races;
}
/** Championship rows. Jolpica omits `position` for drivers/constructors that were
 * not ranked (positionText "-") and marks exclusions in positionText (e.g. "D"),
 * so position is optional here; a present position must still be a valid rank
 * and agree with positionText, and ranked rows must precede unranked ones. */
function standingRows<T>(value: unknown, entity: 'Driver' | 'Constructor'): T[] {
  const list = rows<Record<string, unknown>>(value, ['positionText', 'points', 'wins'], [entity]);
  let unrankedSeen = false;
  let previous = 0;
  for (const row of list) {
    if (row.position === undefined) {
      // An unranked row must not claim a numeric rank in its text either.
      if (/^\d+$/.test(row.positionText as string)) throw new ProviderError('jolpica', 'invalid-response');
      unrankedSeen = true;
      continue;
    }
    const position = nonnegativeInteger(row.position);
    if (position < 1 || unrankedSeen || position < previous || (/^\d+$/.test(row.positionText as string) && row.positionText !== row.position)) throw new ProviderError('jolpica', 'invalid-response');
    previous = position;
  }
  return list as T[];
}
type ResultRace = JolpicaResultsEnvelope['RaceTable']['Races'][number];
/**
 * A car number is not required to identify a qualifying or sprint row (the
 * driver is). Jolpica writes a missing one as "None" (as in race results);
 * drop that value instead of rejecting the whole session.
 */
function withoutMissingCarNumbers<T>(value: T): T {
  if (Array.isArray(value)) for (const row of value) if (isRecord(row) && (row.number === 'None' || row.number === '')) delete row.number;
  return value;
}
interface ResultFilter { season?: number; driverId?: string; constructorId?: string; winner?: boolean }
async function results(path: string, opts: FetchOpts, expected?: RaceIdentity, filter: ResultFilter = {}): Promise<ResultRace[]> {
  const select = (env: JolpicaEnvelope<JolpicaResultsEnvelope>) => {
    for (const race of Array.isArray(env.MRData.RaceTable?.Races) ? env.MRData.RaceTable.Races : []) withoutNoneNumbers(race?.Results);
    tableIdentity(env.MRData.RaceTable, { ...(filter.season === undefined ? {} : { season: filter.season }), ...(filter.driverId ? { driverId: filter.driverId } : {}), ...(filter.constructorId ? { constructorId: filter.constructorId } : {}) });
    const races = rows<ResultRace>(expected ? raceRows<ResultRace>(env, expected) : env.MRData.RaceTable?.Races, ['season','round','raceName','date'], ['Circuit']);
    for (const race of races) {
      if (filter.season !== undefined && nonnegativeInteger(race.season) !== filter.season) throw new ProviderError('jolpica', 'invalid-response');
      for (const result of rows<ResultRace['Results'][number]>(race.Results, ['position','positionText','points'], ['Driver'])) {
        if ((filter.driverId && result.Driver.driverId !== filter.driverId) || (filter.constructorId && result.Constructor?.constructorId !== filter.constructorId) || (filter.winner && result.position !== '1')) throw new ProviderError('jolpica', 'invalid-response');
      }
    }
    return races;
  };
  const all = await pages(path, opts, select, races => races.reduce((sum, race) => sum + rows(race.Results, ['position','positionText','points'], ['Driver']).length, 0));
  const merged = new Map<string, ResultRace>();
  for (const race of all.flatMap(select)) {
    const key = `${race.season}:${race.round}`;
    const prior = merged.get(key);
    if (prior) prior.Results.push(...race.Results);
    else merged.set(key, { ...race, Results: [...race.Results] });
  }
  for (const race of merged.values()) {
    // One driver can hold two rows in a race (1950s shared drives / car swaps, e.g. Fangio 1956 Argentina),
    // so identity is driver + car number + classification order; only a repeated row is rejected.
    const ids = race.Results.map(result => result.Driver?.driverId ? `${result.Driver.driverId}:${result.number}:${result.position}` : '');
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new ProviderError('jolpica', 'invalid-response');
  }
  return [...merged.values()];
}
/** The season a standings table declares (Jolpica names it even when no round is classified yet). */
function declaredSeason(table: unknown): number | null {
  if (!isRecord(table) || table.season === undefined) return null;
  return /^\d{4}$/.test(String(table.season)) ? Number(table.season) : null;
}
/** A championship table. `tableSeason` is the season Jolpica declares, present even when no round is classified. */
export interface StandingsSnapshot<T> { season: string | null; round: number | null; standings: T[]; tableSeason?: number | null }
async function driverSnapshot(season: number | 'current', opts: FetchOpts, winnerOnly = false): Promise<StandingsSnapshot<JolpicaDriverStandingsEnvelope['StandingsTable']['StandingsLists'][number]['DriverStandings'][number]>> {
  validSeason(season);
  const select = (env: JolpicaEnvelope<JolpicaDriverStandingsEnvelope>) => {
    tableIdentity(env.MRData.StandingsTable, season === 'current' ? {} : { season });
    const lists = rows<JolpicaDriverStandingsEnvelope['StandingsTable']['StandingsLists'][number]>(env.MRData.StandingsTable?.StandingsLists, ['season','round']);
    if (season !== 'current' && lists.some(list => nonnegativeInteger(list.season) !== season)) throw new ProviderError('jolpica', 'invalid-response');
    if (winnerOnly && (nonnegativeInteger(env.MRData.total) > 1 || lists.length > 1 || lists.some(list => nonnegativeInteger(list.round) < 1 || rows<JolpicaDriverStandingsEnvelope['StandingsTable']['StandingsLists'][number]['DriverStandings'][number]>(list.DriverStandings, ['position','positionText','points','wins'], ['Driver']).some(row => row.position !== '1' || row.positionText !== '1')))) throw new ProviderError('jolpica', 'invalid-response');
    return lists;
  };
  const all = await pages(`${season}/driverStandings${winnerOnly ? '/1' : ''}.json`, { revalidate: 300, ...opts }, select, lists => lists.reduce((sum, list) => sum + standingRows(list.DriverStandings, 'Driver').length, 0));
  const lists = all.flatMap(select);
  const first = lists[0];
  if (lists.some(list => list.round !== first?.round || list.season !== first?.season)) throw new ProviderError('jolpica', 'incomplete');
  const standings = lists.flatMap(list => list.DriverStandings);
  if (winnerOnly && (standings.length > 1 || standings.some(row => row.position !== '1' || row.positionText !== '1') || first && nonnegativeInteger(first.round) < 1)) throw new ProviderError('jolpica', 'invalid-response');
  if (new Set(standings.map(row => row.Driver.driverId)).size !== standings.length) throw new ProviderError('jolpica', 'incomplete');
  const round = first ? nonnegativeInteger(first.round) : null;
  const ordered = first ? await withLatestTeamLast(standings, nonnegativeInteger(first.season), round, opts) : standings;
  return { season: first?.season ?? null, round, standings: ordered, tableSeason: declaredSeason(all[0]?.MRData.StandingsTable) };
}
/** Above this many multi-team drivers, one season-wide results read is cheaper than one read per driver. */
const PER_DRIVER_TEAM_READS = 3;
/**
 * Jolpica lists a driver's Constructors in first-appearance order, so the last
 * listed team is not always the current one (R3-DATA-1: Lawson 2026 is listed
 * [rb, red_bull] but raced rounds 15-18 for RB). For each driver with more than
 * one team, reorder the list from race entries so the latest team is last.
 * Single-team rows cost nothing. A failed or rate-limited order read keeps the
 * provider order (the standings themselves are verified and still shown), even
 * on strict reads: pages read standings strictly, and losing the whole table
 * to a secondary read would be worse. Nothing persists a team from this list.
 */
async function withLatestTeamLast<T extends { Driver: { driverId: string }; Constructors?: Array<{ constructorId: string }> }>(standings: T[], season: number, round: number | null, opts: FetchOpts): Promise<T[]> {
  const multi = standings.filter(row => (row.Constructors?.length ?? 0) > 1);
  if (!multi.length) return standings;
  const { limit: _limit, offset: _offset, ...rest } = opts;
  const readOpts: FetchOpts = { revalidate: 300, ...rest };
  try {
    const racesFor = new Map<string, ResultRace[]>();
    if (multi.length > PER_DRIVER_TEAM_READS) {
      const races = await results(`${season}/results.json`, readOpts, undefined, { season });
      for (const row of multi) racesFor.set(row.Driver.driverId, races);
    } else {
      await Promise.all(multi.map(async row => {
        const id = slug(row.Driver.driverId);
        racesFor.set(row.Driver.driverId, await results(`${season}/drivers/${id}/results.json`, readOpts, undefined, { season, driverId: id }));
      }));
    }
    return standings.map(row => {
      const races = racesFor.get(row.Driver.driverId);
      return races && row.Constructors ? { ...row, Constructors: orderConstructorsByLatestRace(row.Constructors, row.Driver.driverId, races, round) } : row;
    });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    return standings;
  }
}
async function constructorSnapshot(season: number | 'current', opts: FetchOpts, winnerOnly = false): Promise<StandingsSnapshot<JolpicaConstructorStandingsEnvelope['StandingsTable']['StandingsLists'][number]['ConstructorStandings'][number]>> {
  validSeason(season);
  const select = (env: JolpicaEnvelope<JolpicaConstructorStandingsEnvelope>) => {
    tableIdentity(env.MRData.StandingsTable, season === 'current' ? {} : { season });
    const lists = rows<JolpicaConstructorStandingsEnvelope['StandingsTable']['StandingsLists'][number]>(env.MRData.StandingsTable?.StandingsLists, ['season','round']);
    if (season !== 'current' && lists.some(list => nonnegativeInteger(list.season) !== season)) throw new ProviderError('jolpica', 'invalid-response');
    if (winnerOnly && (nonnegativeInteger(env.MRData.total) > 1 || lists.length > 1 || lists.some(list => nonnegativeInteger(list.round) < 1 || rows<JolpicaConstructorStandingsEnvelope['StandingsTable']['StandingsLists'][number]['ConstructorStandings'][number]>(list.ConstructorStandings, ['position','positionText','points','wins'], ['Constructor']).some(row => row.position !== '1' || row.positionText !== '1')))) throw new ProviderError('jolpica', 'invalid-response');
    return lists;
  };
  const all = await pages(`${season}/constructorStandings${winnerOnly ? '/1' : ''}.json`, { revalidate: 300, ...opts }, select, lists => lists.reduce((sum, list) => sum + standingRows(list.ConstructorStandings, 'Constructor').length, 0));
  const lists = all.flatMap(select);
  const first = lists[0];
  if (lists.some(list => list.round !== first?.round || list.season !== first?.season)) throw new ProviderError('jolpica', 'incomplete');
  const standings = lists.flatMap(list => list.ConstructorStandings);
  if (winnerOnly && (standings.length > 1 || standings.some(row => row.position !== '1' || row.positionText !== '1') || first && nonnegativeInteger(first.round) < 1)) throw new ProviderError('jolpica', 'invalid-response');
  if (new Set(standings.map(row => row.Constructor.constructorId)).size !== standings.length) throw new ProviderError('jolpica', 'incomplete');
  return { season: first?.season ?? null, round: first ? nonnegativeInteger(first.round) : null, standings, tableSeason: declaredSeason(all[0]?.MRData.StandingsTable) };
}
type Driver = JolpicaDriverListEnvelope['DriverTable']['Drivers'][number];
type Constructor = JolpicaConstructorListEnvelope['ConstructorTable']['Constructors'][number];
type Qualifying = JolpicaQualifyingEnvelope['RaceTable']['Races'][number]['QualifyingResults'][number];
type Sprint = JolpicaSprintEnvelope['RaceTable']['Races'][number]['SprintResults'][number];
type PitStop = JolpicaPitStopsEnvelope['RaceTable']['Races'][number]['PitStops'][number];
type Season = { season: string; url: string };
type SprintRace = JolpicaSprintEnvelope['RaceTable']['Races'][number];
/** Paginated sprint results for a filtered path, merged per round (rows of one round can span pages). */
async function sprintRaces(path: string, opts: FetchOpts, filter: { season: number; driverId: string }): Promise<SprintRace[]> {
  const select = (env: JolpicaEnvelope<JolpicaSprintEnvelope>) => {
    tableIdentity(env.MRData.RaceTable, filter);
    const races = rows<SprintRace>(env.MRData.RaceTable?.Races, ['season','round','raceName','date'], ['Circuit']);
    for (const race of races) {
      if (nonnegativeInteger(race.season) !== filter.season) throw new ProviderError('jolpica', 'invalid-response');
      for (const result of rows<SprintRace['SprintResults'][number]>(withoutMissingCarNumbers(race.SprintResults), ['position','positionText','points'], ['Driver'])) {
        if (result.Driver.driverId !== filter.driverId) throw new ProviderError('jolpica', 'invalid-response');
      }
    }
    return races;
  };
  const all = await pages(path, opts, select, races => races.reduce((sum, race) => sum + rows(race.SprintResults, ['position','positionText','points'], ['Driver']).length, 0));
  const merged = new Map<string, SprintRace>();
  for (const race of all.flatMap(select)) {
    const prior = merged.get(race.round);
    if (prior) prior.SprintResults.push(...race.SprintResults);
    else merged.set(race.round, { ...race, SprintResults: [...race.SprintResults] });
  }
  return [...merged.values()];
}
type Seasons = { SeasonTable: { Seasons: Season[] } };

/** A season's calendar plus the season the provider says it is (present even when no race is published yet). */
async function scheduleSnapshot(season: number | 'current', opts: FetchOpts): Promise<{ season: number | null; races: JolpicaRace[] }> {
  validSeason(season);
  const select = (env: JolpicaEnvelope<JolpicaRaceTableEnvelope>) => {
    tableIdentity(env.MRData.RaceTable, season === 'current' ? {} : { season });
    const selected = rows<JolpicaRace>(env.MRData.RaceTable?.Races, ['season','round','raceName','date'], ['Circuit']);
    if (selected.some(race => (season !== 'current' && nonnegativeInteger(race.season) !== season) || nonnegativeInteger(race.round) < 1)) throw new ProviderError('jolpica', 'invalid-response');
    return selected;
  };
  const all = await pages(`${season}.json`, { revalidate: 3600, ...opts }, select);
  const races = all.flatMap(select);
  if (new Set(races.map(race => race.season)).size > 1) throw new ProviderError('jolpica', 'invalid-response');
  const declared = all[0]?.MRData.RaceTable?.season;
  const tableSeason = declared !== undefined && /^\d{4}$/.test(String(declared)) ? Number(declared) : null;
  const raceSeason = races[0] ? nonnegativeInteger(races[0].season) : null;
  if (raceSeason !== null && tableSeason !== null && raceSeason !== tableSeason) throw new ProviderError('jolpica', 'invalid-response');
  return { season: raceSeason ?? tableSeason ?? (season === 'current' ? null : season), races: distinct(races, race => `${race.season}:${race.round}`).sort((a, b) => Number(a.round) - Number(b.round)) };
}

export const jolpica = {
  getSchedule(season: number | 'current' = 'current', opts: FetchOpts = {}) {
    return safe(opts, [] as JolpicaRace[], async () => (await scheduleSnapshot(season, opts)).races);
  },
  /** Like getSchedule, plus the season Jolpica declares (so an empty new-season calendar still names its year). */
  getScheduleSnapshot(season: number | 'current' = 'current', opts: FetchOpts = {}) {
    return safe(opts, { season: null, races: [] } as { season: number | null; races: JolpicaRace[] }, () => scheduleSnapshot(season, opts));
  },
  getDriverStandingsSnapshot(season: number | 'current' = 'current', opts: FetchOpts = {}) {
    return safe(opts, { season: null, round: null, standings: [], tableSeason: null } as Awaited<ReturnType<typeof driverSnapshot>>, () => driverSnapshot(season, opts));
  },
  async getDriverStandings(season: number | 'current' = 'current', opts: FetchOpts = {}) { return (await jolpica.getDriverStandingsSnapshot(season, opts)).standings; },
  getDriverChampionSnapshot(season: number, opts: FetchOpts = {}) {
    return safe(opts, { season: null, round: null, standings: [], tableSeason: null } as Awaited<ReturnType<typeof driverSnapshot>>, () => driverSnapshot(season, opts, true));
  },
  getConstructorStandingsSnapshot(season: number | 'current' = 'current', opts: FetchOpts = {}) {
    return safe(opts, { season: null, round: null, standings: [], tableSeason: null } as Awaited<ReturnType<typeof constructorSnapshot>>, () => constructorSnapshot(season, opts));
  },
  async getConstructorStandings(season: number | 'current' = 'current', opts: FetchOpts = {}) { return (await jolpica.getConstructorStandingsSnapshot(season, opts)).standings; },
  getConstructorChampionSnapshot(season: number, opts: FetchOpts = {}) {
    return safe(opts, { season: null, round: null, standings: [], tableSeason: null } as Awaited<ReturnType<typeof constructorSnapshot>>, () => constructorSnapshot(season, opts, true));
  },
  getDrivers(season: number | 'current' = 'current', opts: FetchOpts = {}) {
    return safe(opts, [] as Driver[], async () => { validSeason(season); return distinct(await flat<JolpicaDriverListEnvelope, Driver>(`${season}/drivers.json`, { revalidate: 3600, ...opts }, env => { tableIdentity(env.MRData.DriverTable, season === 'current' ? {} : { season }); return rows(env.MRData.DriverTable?.Drivers, ['driverId','givenName','familyName']); }), driver => driver.driverId); });
  },
  getAllDrivers(opts: FetchOpts = {}) { return safe(opts, [] as Driver[], async () => distinct(await flat<JolpicaDriverListEnvelope, Driver>('drivers.json', { revalidate: 86400, ...opts }, env => rows(env.MRData.DriverTable?.Drivers, ['driverId','givenName','familyName'])), driver => driver.driverId)); },
  getDriver(driverId: string, opts: FetchOpts = {}) {
    return safe(opts, null as Driver | null, async () => {
      const id = slug(driverId);
      const records = await flat<JolpicaDriverListEnvelope, Driver>(`drivers/${id}.json`, { revalidate: 86400, ...opts }, env => {
        tableIdentity(env.MRData.DriverTable, { driverId: id });
        const selected = rows<Driver>(env.MRData.DriverTable?.Drivers, ['driverId','givenName','familyName']);
        if (selected.some(driver => driver.driverId !== id)) throw new ProviderError('jolpica', 'invalid-response');
        return selected;
      });
      if (records.length > 1) throw new ProviderError('jolpica', 'incomplete');
      return records[0] ?? null;
    });
  },
  getConstructors(season: number | 'current' = 'current', opts: FetchOpts = {}) { return safe(opts, [] as Constructor[], async () => { validSeason(season); return distinct(await flat<JolpicaConstructorListEnvelope, Constructor>(`${season}/constructors.json`, { revalidate: 3600, ...opts }, env => { tableIdentity(env.MRData.ConstructorTable, season === 'current' ? {} : { season }); return rows(env.MRData.ConstructorTable?.Constructors, ['constructorId','name']); }), constructor => constructor.constructorId); }); },
  getAllConstructors(opts: FetchOpts = {}) { return safe(opts, [] as Constructor[], async () => distinct(await flat<JolpicaConstructorListEnvelope, Constructor>('constructors.json', { revalidate: 86400, ...opts }, env => rows(env.MRData.ConstructorTable?.Constructors, ['constructorId','name'])), constructor => constructor.constructorId)); },
  getConstructor(constructorId: string, opts: FetchOpts = {}) {
    return safe(opts, null as Constructor | null, async () => {
      const id = slug(constructorId);
      const records = await flat<JolpicaConstructorListEnvelope, Constructor>(`constructors/${id}.json`, { revalidate: 86400, ...opts }, env => {
        tableIdentity(env.MRData.ConstructorTable, { constructorId: id });
        const selected = rows<Constructor>(env.MRData.ConstructorTable?.Constructors, ['constructorId','name']);
        if (selected.some(constructor => constructor.constructorId !== id)) throw new ProviderError('jolpica', 'invalid-response');
        return selected;
      });
      if (records.length > 1) throw new ProviderError('jolpica', 'incomplete');
      return records[0] ?? null;
    });
  },
  getRaceResults(season: number, round: number, opts: FetchOpts = {}) {
    return safe(opts, null as { race: ResultRace; results: ResultRace['Results'] } | null, async () => { const expected = requestedRace(season, round); const race = (await results(`${season}/${round}/results.json`, { revalidate: 300, ...opts }, expected))[0]; return race ? { race, results: race.Results } : null; });
  },
  getQualifying(season: number, round: number, opts: FetchOpts = {}) { return jolpica.getQualifyingFull(season, round, opts); },
  getQualifyingFull(season: number, round: number, opts: FetchOpts = {}) {
    return safe(opts, [] as Qualifying[], () => { const expected = requestedRace(season, round); return flat<JolpicaQualifyingEnvelope, Qualifying>(`${season}/${round}/qualifying.json`, { revalidate: 3600, ...opts }, env => raceRows<JolpicaQualifyingEnvelope['RaceTable']['Races'][number]>(env, expected).flatMap(race => rows(withoutMissingCarNumbers(race.QualifyingResults), ['position'], ['Driver']))); });
  },
  getSprint(season: number, round: number, opts: FetchOpts = {}) {
    return safe(opts, [] as Sprint[], () => { const expected = requestedRace(season, round); return flat<JolpicaSprintEnvelope, Sprint>(`${season}/${round}/sprint.json`, { revalidate: 3600, ...opts }, env => raceRows<JolpicaSprintEnvelope['RaceTable']['Races'][number]>(env, expected).flatMap(race => rows(withoutMissingCarNumbers(race.SprintResults), ['position','positionText','points'], ['Driver']))); });
  },
  getPitStops(season: number, round: number, opts: FetchOpts = {}) {
    return safe(opts, [] as PitStop[], () => { const expected = requestedRace(season, round); return flat<JolpicaPitStopsEnvelope, PitStop>(`${season}/${round}/pitstops.json`, { revalidate: 86400, ...opts }, env => raceRows<JolpicaPitStopsEnvelope['RaceTable']['Races'][number]>(env, expected).flatMap(race => rows(race.PitStops, ['driverId','lap','stop','time','duration']))); });
  },
  getLaps(season: number, round: number, opts: FetchOpts = {}) {
    return safe(opts, [] as JolpicaLapEntry[], async () => {
      const expected = requestedRace(season, round);
      const select = (env: JolpicaEnvelope<JolpicaLapsEnvelope>) => raceRows<JolpicaLapsEnvelope['RaceTable']['Races'][number]>(env, expected).flatMap(race => rows<JolpicaLapEntry>(race.Laps, ['number']));
      const all = await pages(`${season}/${round}/laps.json`, { revalidate: 86400, ...opts }, select, laps => laps.reduce((sum, lap) => sum + rows(lap.Timings, ['driverId','position','time']).length, 0));
      const merged = new Map<string, JolpicaLapEntry>();
      for (const lap of all.flatMap(select)) {
        const prior = merged.get(lap.number);
        if (prior) prior.Timings.push(...lap.Timings);
        else merged.set(lap.number, { ...lap, Timings: [...lap.Timings] });
      }
      for (const lap of merged.values()) if (new Set(lap.Timings.map(timing => timing.driverId)).size !== lap.Timings.length) throw new ProviderError('jolpica', 'incomplete');
      return [...merged.values()].sort((a, b) => Number(a.number) - Number(b.number));
    });
  },
  /** Race winners only (P1 of every completed round), one small paginated request. */
  getSeasonWinners(season: number | 'current' = 'current', opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => { validSeason(season); return results(`${season}/results/1.json`, { revalidate: 3600, ...opts }, undefined, { ...(season === 'current' ? {} : { season }), winner: true }); }); },
  /** Every classified race since 1950 with its winner(s): season, round and circuit for each race page. About 12 paginated requests. */
  getAllRaceWinners(opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => results('results/1.json', { revalidate: 86400, ...opts }, undefined, { winner: true })); },
  getSeasonResults(season: number, opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => { validSeason(season); return results(`${season}/results.json`, { revalidate: 3600, ...opts }, undefined, { season }); }); },
  getDriverResults(driverId: string, opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => { const id = slug(driverId); return results(`drivers/${id}/results.json`, { revalidate: 3600, ...opts }, undefined, { driverId: id }); }); },
  getDriverResultsInSeason(driverId: string, season: number, opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => { validSeason(season); const id = slug(driverId); return results(`${season}/drivers/${id}/results.json`, { revalidate: 3600, ...opts }, undefined, { season, driverId: id }); }); },
  getConstructorResultsInSeason(constructorId: string, season: number, opts: FetchOpts = {}) { return safe(opts, [] as ResultRace[], () => { validSeason(season); const id = slug(constructorId); return results(`${season}/constructors/${id}/results.json`, { revalidate: 3600, ...opts }, undefined, { season, constructorId: id }); }); },
  /** A driver's sprint results in one season (sprints exist from 2021). */
  getDriverSprintsInSeason(driverId: string, season: number, opts: FetchOpts = {}) { return safe(opts, [] as SprintRace[], () => { validSeason(season); const id = slug(driverId); return sprintRaces(`${season}/drivers/${id}/sprint.json`, { revalidate: 3600, ...opts }, { season, driverId: id }); }); },
  /**
   * Every team a driver entered in a season, from race entries, with the points
   * scored for each (Grand Prix plus sprint). Ordered so the current team is last.
   * Empty when the provider read fails (render paths fail soft).
   */
  getDriverTeamStints(driverId: string, season: number, opts: FetchOpts = {}) {
    return safe(opts, [] as TeamStint[], async () => {
      const strict = { ...opts, strict: true };
      const [races, sprints] = await Promise.all([jolpica.getDriverResultsInSeason(driverId, season, strict), season >= 2021 ? jolpica.getDriverSprintsInSeason(driverId, season, strict) : Promise.resolve([] as SprintRace[])]);
      return teamStints(slug(driverId), races, sprints);
    });
  },
  getDriverSeasons(driverId: string, opts: FetchOpts = {}) {
    return safe(opts, [] as number[], async () => { const id = slug(driverId); return distinct(await flat<Seasons, Season>(`drivers/${id}/seasons.json`, { revalidate: 86400, ...opts }, env => { tableIdentity(env.MRData.SeasonTable, { driverId: id }); return rows(env.MRData.SeasonTable?.Seasons, ['season']); }), season => season.season).map(season => nonnegativeInteger(season.season)); });
  },
  getSeasons(opts: FetchOpts = {}) { return safe(opts, [] as Season[], async () => distinct(await flat<Seasons, Season>('seasons.json', { revalidate: 86400, ...opts }, env => rows(env.MRData.SeasonTable?.Seasons, ['season'])), season => season.season)); },
};
