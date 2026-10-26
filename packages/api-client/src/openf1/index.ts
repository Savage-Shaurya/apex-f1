// OpenF1 client. Live + recent session data.
// Docs: https://openf1.org/
import { ProviderError, failOr, isRecord, requestJson, untrackedFetch, type ProviderRequestOptions } from '../transport';
import { resolveProviderBase } from '../provider-base';
import { defaultOpenF1LastGoodStore, openF1LastGoodKey, type OpenF1LastGoodStore } from './last-good';

export * from './last-good';


/** Cap upstream latency so a stalled provider cannot pin a serverless function. */
const REQUEST_TIMEOUT_MS = 8000;
/** Overridable only for local development on loopback (see scripts/dev/provider-cache.mjs). */
const OPENF1_DEFAULT_BASE = 'https://api.openf1.org/v1';
const PROVIDER_BASE = resolveProviderBase('OPENF1_BASE_URL', OPENF1_DEFAULT_BASE);
const BASE = PROVIDER_BASE.base;

export interface FetchOpts extends ProviderRequestOptions {
  revalidate?: number;
  strict?: boolean;
  dateGte?: string;
  dateLte?: string;
  /** Explicit supported Bearer access token; never included in logs/URLs. */
  accessToken?: string;
  /**
   * Last-good snapshot use. Every successful real response is recorded.
   *   - 'fallback': ask OpenF1; if it refuses or fails, serve the last good
   *     snapshot of the same query (reported through onProvenance).
   *   - 'only': do not call OpenF1; serve the snapshot or fail.
   * Unset: never serve a snapshot (callers that republish data as fresh).
   */
  lastGood?: 'fallback' | 'only';
  /** Told where the returned rows came from and when they were fetched. */
  onProvenance?: (provenance: OpenF1Provenance) => void;
  /** Override the snapshot store (tests). null disables recording and serving. */
  lastGoodStore?: OpenF1LastGoodStore | null;
  /**
   * Runs the last-good write after the response (Next's `after()`), so on
   * serverless it is not dropped when the response ends (R3-CODE-8). Without
   * it the write is fire-and-forget.
   */
  deferWrite?: (task: () => Promise<void>) => void;
}

export type OpenF1FailureReason = 'live-session-lockout' | 'rate-limit' | 'timeout' | 'provider-error';
export interface OpenF1Provenance {
  /** 'provider' = a response from OpenF1 just now; 'last-good' = a stored earlier response. */
  source: 'provider' | 'last-good';
  /** When OpenF1 produced these rows (ms since epoch). */
  asOf: number;
  /** Why the stored copy was used. */
  reason?: OpenF1FailureReason;
}

/**
 * OpenF1 refuses all unauthenticated requests (past sessions included) while
 * a Formula 1 session is live: HTTP 401 with "Live F1 session in progress".
 */
export class OpenF1LiveSessionLockout extends ProviderError {
  constructor() {
    super('openf1', 'http', 401);
    this.name = 'OpenF1LiveSessionLockout';
  }
}

export function openF1FailureReason(error: unknown): OpenF1FailureReason | null {
  if (error instanceof OpenF1LiveSessionLockout) return 'live-session-lockout';
  if (!(error instanceof ProviderError)) return null;
  if (error.code === 'rate-limit' || (error.code === 'http' && error.status === 429)) return 'rate-limit';
  if (error.code === 'timeout') return 'timeout';
  if (error.code === 'http' || error.code === 'network') return 'provider-error';
  return null;
}

const LOCKOUT_TEXT = /live f1 session in progress/i;
/** After a live-session refusal, skip further doomed OpenF1 requests from this process for a minute. */
export const OPENF1_LOCKOUT_MEMO_MS = 60_000;
const lockoutState = globalThis as typeof globalThis & { __apexOpenF1LockedUntil?: number };
/** Test hook. */
export function resetOpenF1LockoutMemo(): void { lockoutState.__apexOpenF1LockedUntil = 0; }
/**
 * True while this process remembers a live-session refusal and has no access
 * token to get past it. Callers use it to skip shared admission for reads that
 * are certain to be refused (R3-BE-1).
 */
export function isOpenF1LockedOut(now = Date.now()): boolean {
  return !process.env.OPENF1_ACCESS_TOKEN && (lockoutState.__apexOpenF1LockedUntil ?? 0) > now;
}
/** Recognise the live-session refusal without ever logging or keeping its body. */
function lockoutAwareFetch(base: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await base(input, init);
    // OpenF1 answers a query that matches nothing with 404 "No results found."
    // That is confirmed empty data, not a failure.
    if (response.status === 404) {
      const text = await response.clone().text().catch(() => '');
      if (/^\s*\{\s*"detail"\s*:\s*"No results found\.?"\s*\}\s*$/i.test(text.slice(0, 200))) return Response.json([]);
    }
    if (response.status === 401 || response.status === 403) {
      const text = await response.clone().text().catch(() => '');
      if (LOCKOUT_TEXT.test(text.slice(0, 2000))) throw new OpenF1LiveSessionLockout();
    }
    return response;
  }) as typeof fetch;
}
export function getOpenF1AccessConfig(): { hasAccessToken: boolean; realtimeConfigured: boolean } {
  const hasAccessToken = Boolean(process.env.OPENF1_ACCESS_TOKEN);
  return { hasAccessToken, realtimeConfigured: hasAccessToken && process.env.OPENF1_REALTIME_ENABLED === 'true' };
}
function utcDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ProviderError('openf1', 'invalid-input');
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new ProviderError('openf1', 'invalid-input');
  return instant.toISOString().slice(0, 19);
}

function validRecord(path: string, item: Record<string, unknown>): boolean {
  const positiveInteger = (key: string) => typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] > 0;
  const text = (key: string) => typeof item[key] === 'string';
  const instant = (key: string) => text(key) && /T\d{2}:\d{2}/.test(item[key] as string) && Number.isFinite(Date.parse(item[key] as string));
  if (path === 'meetings') return positiveInteger('meeting_key') && text('meeting_name') && instant('date_start');
  if (!positiveInteger('session_key')) return false;
  if (path === 'sessions') {
    const label = (key: string) => text(key) && (item[key] as string).trim().length > 0 && (item[key] as string).length <= 300;
    const sessionInstant = (key: string) => instant(key) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(item[key] as string)
      && new Date(`${(item[key] as string).slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === (item[key] as string).slice(0, 10);
    // These fields back public session details. A partial provider record must
    // fail as unavailable rather than render undefined metadata or a false race.
    return positiveInteger('meeting_key') && positiveInteger('circuit_key') && positiveInteger('year')
      && (item.year as number) >= 1950 && (item.year as number) <= 9999
      && ['session_name', 'session_type', 'location', 'country_name', 'country_code', 'circuit_short_name', 'gmt_offset'].every(label)
      && sessionInstant('date_start') && sessionInstant('date_end')
      && Date.parse(item.date_start as string) < Date.parse(item.date_end as string)
      && (item.is_cancelled === undefined || typeof item.is_cancelled === 'boolean');
  }
  if (path === 'drivers') return positiveInteger('driver_number') && text('full_name') && text('name_acronym');
  if (path === 'stints') return positiveInteger('driver_number') && positiveInteger('stint_number') && text('compound')
    && ['lap_start', 'lap_end', 'tyre_age_at_start'].every(key => item[key] == null || (typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] >= 0));
  if (path === 'laps') return positiveInteger('driver_number') && positiveInteger('lap_number') && (item.date_start == null || instant('date_start'));
  // Final classification of a finished session (free historical data, no live use).
  // OpenF1 may send a short classification code in place of a place ("RT" for a
  // car that retired in qualifying); it is kept as position_code (R3-CODE-1).
  if (path === 'session_result') return positiveInteger('driver_number')
    && (item.position == null || positiveInteger('position') || (typeof item.position === 'string' && /^[A-Z]{2,3}$/.test(item.position)))
    && ['dnf', 'dns', 'dsq'].every(key => item[key] == null || typeof item[key] === 'boolean');
  // Starting grid, stored under the qualifying (or sprint qualifying) session.
  if (path === 'starting_grid') return positiveInteger('driver_number') && positiveInteger('position')
    && (item.lap_duration == null || (typeof item.lap_duration === 'number' && Number.isFinite(item.lap_duration)));
  if (!instant('date')) return false;
  if (path === 'race_control') return text('category') && text('message');
  if (path === 'weather') return ['air_temperature','track_temperature','humidity','pressure','wind_speed','wind_direction','rainfall'].every(key => item[key] == null || (typeof item[key] === 'number' && Number.isFinite(item[key])));
  if (!positiveInteger('driver_number')) return false;
  if (path === 'position') return positiveInteger('position');
  if (path === 'intervals') return ('gap_to_leader' in item || 'interval' in item) && ['gap_to_leader','interval'].every(key => item[key] == null || typeof item[key] === 'string' || (typeof item[key] === 'number' && Number.isFinite(item[key])));
  if (path === 'location') return ['x','y','z'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]));
  if (path === 'pit') return positiveInteger('lap_number');
  return false;
}

function validateRows(path: string, params: Record<string, string | number>, opts: FetchOpts, json: unknown): unknown[] {
  if (!Array.isArray(json) || json.some(item => {
    if (!isRecord(item) || !validRecord(path, item)) return true;
    // A valid record from another session/meeting/driver is still a wrong
    // response. Never relabel a provider's foreign rows as the requested race.
    return ['session_key', 'meeting_key', 'driver_number'].some(key =>
      typeof params[key] === 'number' && item[key] !== params[key])
      || (typeof params.name_acronym === 'string' && item.name_acronym !== params.name_acronym)
      || (opts.dateGte !== undefined && typeof item.date === 'string' && Date.parse(item.date) <= Date.parse(`${utcDate(opts.dateGte)}Z`))
      || (opts.dateLte !== undefined && typeof item.date === 'string' && Date.parse(item.date) >= Date.parse(`${utcDate(opts.dateLte)}Z`));
  })) throw new ProviderError('openf1', 'invalid-response');
  return json;
}

async function get<T>(path: string, params: Record<string, string | number> = {}, opts: FetchOpts = {}): Promise<T> {
  let lastGoodKey: string | null = null;
  // Injected transports (tests, cache decoders) never touch the shared snapshot store.
  const store = opts.lastGoodStore !== undefined ? opts.lastGoodStore : (opts.fetchImpl ? null : defaultOpenF1LastGoodStore());
  const fromSnapshot = async (reason?: OpenF1FailureReason): Promise<T | null> => {
    if (!store || !lastGoodKey) return null;
    const entry = await store.read(lastGoodKey).catch(() => null);
    if (!entry) return null;
    try { validateRows(path, params, opts, entry.rows); } catch { return null; }
    opts.onProvenance?.({ source: 'last-good', asOf: entry.storedAt, ...(reason ? { reason } : {}) });
    return entry.rows as T;
  };
  try {
    const url = new URL(`${BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'number' && (!Number.isSafeInteger(v) || v <= 0)) throw new ProviderError('openf1', 'invalid-input');
      url.searchParams.set(k, String(v));
    }
    if (opts.dateGte) url.searchParams.set('date>', utcDate(opts.dateGte));
    if (opts.dateLte) url.searchParams.set('date<', utcDate(opts.dateLte));
    if (opts.dateGte && opts.dateLte && Date.parse(opts.dateGte) > Date.parse(opts.dateLte)) throw new ProviderError('openf1', 'invalid-input');
    lastGoodKey = openF1LastGoodKey(path, params, opts.dateGte ? utcDate(opts.dateGte) : undefined, opts.dateLte ? utcDate(opts.dateLte) : undefined);
    if (opts.lastGood === 'only') {
      const stored = await fromSnapshot();
      if (stored === null) throw new ProviderError('openf1', 'incomplete');
      return stored;
    }
    const token = opts.accessToken ?? process.env.OPENF1_ACCESS_TOKEN;
    // While a session is live OpenF1 refuses every free request; do not spend
    // quota re-learning that (injected transports are tests/decoders and are exempt).
    if (!opts.fetchImpl && !token && (lockoutState.__apexOpenF1LockedUntil ?? 0) > Date.now()) throw new OpenF1LiveSessionLockout();
    const headers: Record<string, string> = { Accept: 'application/json' };
    // The bearer token is only ever sent to the real OpenF1 host over HTTPS.
    if (token && !PROVIDER_BASE.overridden && BASE === OPENF1_DEFAULT_BASE) headers.Authorization = `Bearer ${token}`;
    // A fresh read (revalidate 0: shared-store refreshes, live snapshots) bypasses Next's fetch
    // cache entirely. Through the instrumented fetch it would mark an ISR page dynamic at
    // runtime ("Page changed from static to dynamic") and fail the page instead of refreshing it.
    const fresh = opts.revalidate === 0;
    // When the provider produced this response: its Date header, which a Data
    // Cache hit keeps from the original response. Date.now() would label an
    // hours-old cached body as fetched just now (R3-CODE-8).
    let providerDate: number | null = null;
    const baseFetch = opts.fetchImpl ?? (fresh ? untrackedFetch() : fetch);
    const datedFetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const response = await baseFetch(input, init);
      const date = Date.parse(response.headers.get('date') ?? '');
      providerDate = Number.isFinite(date) ? date : null;
      return response;
    }) as typeof fetch;
    const json = await requestJson<unknown>('openf1', url, {
      headers,
      ...(fresh ? { cache: 'no-store' } : { next: opts.revalidate !== undefined ? { revalidate: opts.revalidate } : undefined }),
    } as RequestInit, { timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: 8_000_000, ...opts, fetchImpl: lockoutAwareFetch(datedFetch) });
    const rows = validateRows(path, params, opts, json);
    const fetchedAt = Date.now();
    // A Date in the future (clock skew) or implausibly old header falls back to the read time.
    const dated = providerDate as number | null;
    const storedAt = dated !== null && dated <= fetchedAt + 5_000 && dated > fetchedAt - 30 * 86_400_000 ? Math.min(dated, fetchedAt) : fetchedAt;
    if (store) {
      const entry = { version: 1 as const, key: lastGoodKey, storedAt, rows };
      const write = () => store.write(entry).catch(() => undefined);
      if (opts.deferWrite) opts.deferWrite(write); else void write();
    }
    opts.onProvenance?.({ source: 'provider', asOf: storedAt });
    return rows as T;
  } catch (error) {
    const reason = openF1FailureReason(error);
    if (reason === 'live-session-lockout' && !opts.fetchImpl) lockoutState.__apexOpenF1LockedUntil = Math.max(lockoutState.__apexOpenF1LockedUntil ?? 0, Date.now() + OPENF1_LOCKOUT_MEMO_MS);
    if (opts.lastGood === 'fallback' && reason) {
      const stored = await fromSnapshot(reason);
      if (stored !== null) return stored;
    }
    return failOr('openf1', error, opts.strict, [] as unknown as T);
  }
}

export interface OpenF1Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  circuit_key: number;
  circuit_short_name: string;
  country_code: string;
  country_name: string;
  location: string;
  gmt_offset: string;
  year: number;
  is_cancelled?: boolean;
}

export interface OpenF1Meeting {
  meeting_key: number;
  meeting_name: string;
  meeting_official_name: string;
  location: string;
  country_name: string;
  country_code: string;
  circuit_key: number;
  circuit_short_name: string;
  date_start: string;
  year: number;
  gmt_offset: string;
}

export interface OpenF1Driver {
  session_key: number;
  driver_number: number;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  country_code: string;
  headshot_url?: string;
}

export interface OpenF1Interval {
  session_key: number;
  driver_number: number;
  gap_to_leader?: number | string | null;
  interval?: number | string | null;
  date: string;
}

export interface OpenF1Position {
  session_key: number;
  driver_number: number;
  position: number;
  date: string;
}

export interface OpenF1Location {
  session_key: number;
  driver_number: number;
  x: number;
  y: number;
  z: number;
  date: string;
}

export interface OpenF1Lap {
  session_key: number;
  driver_number: number;
  lap_number: number;
  lap_duration?: number;
  duration_sector_1?: number;
  duration_sector_2?: number;
  duration_sector_3?: number;
  date_start: string;
  is_pit_out_lap?: boolean;
}

export interface OpenF1Stint {
  session_key: number;
  driver_number: number;
  stint_number: number;
  compound: 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | 'UNKNOWN';
  lap_start?: number | null;
  lap_end?: number | null;
  tyre_age_at_start?: number | null;
}

export interface OpenF1RaceControlMessage {
  session_key: number;
  date: string;
  category: string;
  flag?: string;
  message: string;
  driver_number?: number;
  lap_number?: number;
  sector?: number;
  scope?: string;
}

export interface OpenF1Weather {
  session_key: number;
  meeting_key?: number;
  date: string;
  air_temperature?: number;
  track_temperature?: number;
  humidity?: number;
  pressure?: number;
  wind_speed?: number;
  wind_direction?: number;
  rainfall?: number;
}

/** One row of a finished session's classification (`/session_result`). */
export interface OpenF1SessionResult {
  session_key: number;
  meeting_key?: number;
  driver_number: number;
  /** Null when the driver set no classified time, or when OpenF1 sent a code (see position_code). */
  position: number | null;
  /** A classification code OpenF1 sent in place of a place ("RT", "DQ", "NC"); position is then null. */
  position_code?: string | null;
  number_of_laps?: number | null;
  dnf?: boolean | null;
  dns?: boolean | null;
  dsq?: boolean | null;
  /** Seconds; qualifying returns one value per part (Q1, Q2, Q3). */
  duration?: number | Array<number | null> | null;
  gap_to_leader?: number | string | Array<number | string | null> | null;
}

export interface OpenF1Pit {
  session_key: number;
  driver_number: number;
  lap_number: number;
  date: string;
  pit_duration?: number;
}

/** One row of `/starting_grid`. */
export interface OpenF1StartingGridRow {
  session_key: number;
  meeting_key?: number;
  driver_number: number;
  position: number;
  lap_duration: number | null;
}

/** A coded position becomes position null plus its code, so tables never sort or print a string as a place. */
export function normaliseSessionResultRow<T extends { position: number | string | null }>(row: T): Omit<T, 'position'> & { position: number | null; position_code?: string | null } {
  if (typeof row.position === 'string') return { ...row, position: null, position_code: row.position };
  return row as Omit<T, 'position'> & { position: number | null };
}

export const openf1 = {
  async getLatestSession(opts: FetchOpts = {}) {
    const res = await get<OpenF1Session[]>('sessions', { session_key: 'latest' }, { revalidate: 30, ...opts });
    return res[0] ?? null;
  },

  async getSession(sessionKey: number | 'latest', opts: FetchOpts = {}) {
    const res = await get<OpenF1Session[]>('sessions', { session_key: sessionKey }, { revalidate: 30, ...opts });
    return res[0] ?? null;
  },

  async getSessionsForMeeting(meetingKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Session[]>('sessions', { meeting_key: meetingKey }, { revalidate: 60, ...opts });
  },

  /** Every published session of one championship year (about 130 rows). */
  async getSessionsForYear(year: number, opts: FetchOpts = {}) {
    if (!Number.isSafeInteger(year) || year < 2018 || year > 9999) return failOr('openf1', new ProviderError('openf1', 'invalid-input'), opts.strict, [] as OpenF1Session[]);
    const rows = await get<OpenF1Session[]>('sessions', { year }, { revalidate: 3600, ...opts });
    // A row from another year is a wrong response, not data for this one.
    if (rows.some((row) => row.year !== year)) return failOr('openf1', new ProviderError('openf1', 'invalid-response'), opts.strict, [] as OpenF1Session[]);
    return rows;
  },

  async getLatestMeeting(opts: FetchOpts = {}) {
    const res = await get<OpenF1Meeting[]>('meetings', { meeting_key: 'latest' }, { revalidate: 60, ...opts });
    return res[0] ?? null;
  },

  async getDrivers(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Driver[]>('drivers', { session_key: sessionKey }, { revalidate: 60, ...opts });
  },

  /** Final classification of one session; publish it only once the session has ended. */
  async getSessionResult(sessionKey: number, opts: FetchOpts = {}) {
    const rows = await get<Array<Omit<OpenF1SessionResult, 'position'> & { position: number | string | null }>>('session_result', { session_key: sessionKey }, { revalidate: 300, ...opts });
    return rows.map(normaliseSessionResultRow);
  },

  /** Starting grid of a race or sprint, stored by OpenF1 under its qualifying session. */
  async getStartingGrid(qualifyingSessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1StartingGridRow[]>('starting_grid', { session_key: qualifyingSessionKey }, { revalidate: 3600, ...opts });
  },

  /** One meeting by key; null when OpenF1 has none. */
  async getMeeting(meetingKey: number, opts: FetchOpts = {}) {
    const rows = await get<OpenF1Meeting[]>('meetings', { meeting_key: meetingKey }, { revalidate: 3600, ...opts });
    return rows[0] ?? null;
  },

  async getDriversByAcronym(acronym: string, opts: FetchOpts = {}) {
    if (!/^[A-Z]{2,5}$/.test(acronym)) return failOr('openf1', new ProviderError('openf1', 'invalid-input'), opts.strict, []);
    return get<OpenF1Driver[]>('drivers', { name_acronym: acronym }, { revalidate: 3600, ...opts });
  },

  async getIntervals(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Interval[]>('intervals', { session_key: sessionKey }, { revalidate: 5, ...opts });
  },

  async getPositions(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Position[]>('position', { session_key: sessionKey }, { revalidate: 5, ...opts });
  },

  /**
   * GPS location samples (x, y) for cars. Heavy endpoint, so always bound it with
   * a date window. Used to trace the circuit outline (one driver, ~90s lap) and
   * plot position dots (all drivers, last few seconds). Returns [] on error.
   */
  async getLocation(
    sessionKey: number,
    opts: FetchOpts & {
      driverNumber?: number;
      dateGte?: string;
      dateLte?: string;
      revalidate?: number;
      fetchImpl?: typeof fetch;
    } = {},
  ): Promise<OpenF1Location[]> {
    if (!opts.dateGte || !opts.dateLte || Date.parse(opts.dateLte) - Date.parse(opts.dateGte) > 10 * 60_000) return failOr('openf1', new ProviderError('openf1', 'invalid-input'), opts.strict, []);
    const params: Record<string, number> = { session_key: sessionKey };
    if (opts.driverNumber != null) params.driver_number = opts.driverNumber;
    return get<OpenF1Location[]>('location', params, opts);
  },

  async getLaps(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Lap[]>('laps', { session_key: sessionKey }, { revalidate: 15, ...opts });
  },

  async getStints(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Stint[]>('stints', { session_key: sessionKey }, { revalidate: 60, ...opts });
  },

  async getRaceControl(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1RaceControlMessage[]>('race_control', { session_key: sessionKey }, {
      revalidate: 15,
      ...opts,
    });
  },

  async getWeather(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Weather[]>('weather', { session_key: sessionKey }, { revalidate: 60, ...opts });
  },

  /** Weather samples for a whole race weekend (each row carries its session_key). */
  async getWeatherForMeeting(meetingKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Weather[]>('weather', { meeting_key: meetingKey }, { revalidate: 600, ...opts });
  },

  async getPits(sessionKey: number, opts: FetchOpts = {}) {
    return get<OpenF1Pit[]>('pit', { session_key: sessionKey }, { revalidate: 30, ...opts });
  },
};
