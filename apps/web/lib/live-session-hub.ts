import type {
  OpenF1Driver, OpenF1Interval, OpenF1Position, OpenF1RaceControlMessage,
  OpenF1Session, OpenF1Weather,
} from '@apex/api-client/openf1';

export type LiveDelivery = 'live' | 'snapshot' | 'stale' | 'unavailable';
export type LiveEventName = 'session_state' | 'tower' | 'race_control' | 'weather' | 'heartbeat';
export interface LiveFrame { event: LiveEventName; data: Record<string, unknown> }
export interface LiveFetchOptions {
  strict: true;
  revalidate: number;
  signal: AbortSignal;
  timeoutMs: number;
  dateGte?: string;
  dateLte?: string;
}
interface LiveSource {
  getLatestSession(options: LiveFetchOptions): Promise<OpenF1Session | null>;
  getDrivers(key: number, options: LiveFetchOptions): Promise<OpenF1Driver[]>;
  getIntervals(key: number, options: LiveFetchOptions): Promise<OpenF1Interval[]>;
  getPositions(key: number, options: LiveFetchOptions): Promise<OpenF1Position[]>;
  getRaceControl(key: number, options: LiveFetchOptions): Promise<OpenF1RaceControlMessage[]>;
  getWeather(key: number, options: LiveFetchOptions): Promise<OpenF1Weather[]>;
}
export interface HubDependencies {
  source: LiveSource;
  access: () => { realtimeConfigured: boolean };
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Distributed owners must obtain a fenced global slot before every request. */
  beforeRequest?: (signal: AbortSignal) => Promise<void>;
  afterRequest?: () => Promise<void>;
  /** Await durable publication after applying each completed source channel. */
  onChannelSettled?: (read: LiveChannelRead, signal: AbortSignal) => Promise<void>;
}
export interface LiveChannelRead {
  channel: LiveSourceChannel;
  data: unknown;
  succeeded: boolean;
  options: LiveFetchOptions;
  acquisitionStartedAt: number;
  acquisitionCompletedAt: number;
}
interface HubPolicy {
  requestGapMs?: number;
  requestsPerMinute?: number;
  automatic?: boolean;
}
export type LiveSourceChannel = 'session' | 'drivers' | 'positions' | 'intervals' | 'race_control' | 'weather';
type Channel = LiveSourceChannel;
const CADENCE: Record<Channel, number> = {
  session: 60_000, drivers: 300_000, positions: 12_000,
  intervals: 12_000, race_control: 20_000, weather: 60_000,
};
const LIVE_ACCESS_MARGIN_MS = 30 * 60_000;
const FRESH_TIMING_MS = 30_000;

/** Remove the abort listener on both completion paths; never accumulate tick listeners. */
export function waitForLiveTick(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

function sampleTime(value: string | undefined): number | null {
  if (typeof value !== 'string' || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sampleNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function cleanSession(value: OpenF1Session | null): OpenF1Session | null {
  if (!value || !Number.isSafeInteger(value.session_key) || value.session_key <= 0) return null;
  const start = sampleTime(value.date_start);
  const end = sampleTime(value.date_end);
  if (start === null || end === null || end < start) return null;
  const text = (input: unknown) => typeof input === 'string' ? input.slice(0, 200) : '';
  return {
    session_key: value.session_key, date_start: value.date_start, date_end: value.date_end,
    session_type: text(value.session_type), session_name: text(value.session_name),
    meeting_key: value.meeting_key, circuit_key: value.circuit_key,
    circuit_short_name: text(value.circuit_short_name), country_code: text(value.country_code),
    country_name: text(value.country_name), location: text(value.location),
    gmt_offset: text(value.gmt_offset), year: value.year, is_cancelled: value.is_cancelled === true,
  };
}

function displayGap(value: number | string | null | undefined) {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  return typeof value === 'string' ? value.slice(0, 40) : undefined;
}

/**
 * One bounded ingestion owner per Node process, independent of viewer count.
 * This is a process cache, not a distributed quota or durable race-day fanout.
 */
export function createLiveSessionHub(dependencies: HubDependencies, policy: HubPolicy = {}) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.wait ?? waitForLiveTick;
  const requestGapMs = policy.requestGapMs ?? 2_300;
  const requestsPerMinute = policy.requestsPerMinute ?? 26;
  const listeners = new Set<(frame: LiveFrame) => void>();
  const cached = new Map<LiveEventName, LiveFrame>();
  const signatures = new Map<LiveEventName, string>();
  const attempts = new Map<Channel, number>();
  const failures = new Set<Channel>();
  const loaded = new Set<Channel>();
  const settledReads = new Map<Channel, LiveChannelRead>();
  const requestStarts: number[] = [];
  let lastRequestAt: number | null = null;
  let session: OpenF1Session | null = null;
  let sessionFailed = false;
  let drivers = new Map<number, OpenF1Driver>();
  let positions = new Map<number, OpenF1Position>();
  let intervals = new Map<number, OpenF1Interval>();
  let raceControl: OpenF1RaceControlMessage[] = [];
  let weather: OpenF1Weather | null = null;
  let abort: AbortController | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let upstreamRequests = 0;
  let positionBootstrapAttempted = false;

  const activeWindow = () => {
    if (!session || session.is_cancelled) return false;
    const start = sampleTime(session.date_start);
    const end = sampleTime(session.date_end);
    return start !== null && end !== null && now() >= start && now() <= end;
  };
  const protectedWindow = () => {
    if (!session || session.is_cancelled) return false;
    const start = sampleTime(session.date_start);
    const end = sampleTime(session.date_end);
    return start !== null && end !== null && now() >= start - LIVE_ACCESS_MARGIN_MS && now() <= end + LIVE_ACCESS_MARGIN_MS;
  };
  const timingTimestamp = () => {
    let latest: number | null = null;
    for (const value of [...positions.values(), ...intervals.values()]) {
      const timestamp = sampleTime(value.date);
      if (timestamp !== null && timestamp <= now() + 5_000) latest = Math.max(latest ?? timestamp, timestamp);
    }
    return latest;
  };
  const delivery = (): LiveDelivery => {
    if (!session) return loaded.has('session') && !sessionFailed ? 'snapshot' : 'unavailable';
    if (sessionFailed) return positions.size ? 'stale' : 'unavailable';
    if (protectedWindow() && !dependencies.access().realtimeConfigured) return 'unavailable';
    if (failures.has('positions') || failures.has('intervals')) return timingTimestamp() === null ? 'unavailable' : 'stale';
    const timestamp = timingTimestamp();
    if (!activeWindow()) return 'snapshot';
    return timestamp !== null && now() - timestamp <= FRESH_TIMING_MS ? 'live' : 'stale';
  };
  const publish = (event: LiveEventName, data: Record<string, unknown>, signatureData = data) => {
    const signature = JSON.stringify(signatureData);
    if (event !== 'heartbeat' && signatures.get(event) === signature) return;
    const frame = { event, data };
    if (event !== 'heartbeat') { signatures.set(event, signature); cached.set(event, frame); }
    for (const listener of listeners) {
      try { listener(frame); } catch { /* A failed viewer cannot interrupt ingestion. */ }
    }
  };
  const publishSession = () => {
    const timestamp = timingTimestamp();
    const status = delivery();
    const realtimeAvailable = dependencies.access().realtimeConfigured;
    const common = {
      status, delivery: status, realtimeAvailable, dataTimestamp: timestamp,
      lastDataAt: timestamp, sourceUpdatedAt: timestamp,
      detail: !session && status === 'snapshot' ? 'No session is currently scheduled or active.'
        : session?.is_cancelled ? 'This session was cancelled; no live telemetry is being requested.' : status === 'unavailable'
        ? 'Real-time access is unavailable; no current telemetry is verified.'
        : status === 'stale' ? 'Showing the last received telemetry; updates are delayed.' : undefined,
    };
    if (!session) { publish('session_state', { state: 'no_session', ...common }); return; }
    const start = sampleTime(session.date_start) ?? Number.POSITIVE_INFINITY;
    const end = sampleTime(session.date_end) ?? Number.NEGATIVE_INFINITY;
    publish('session_state', {
      state: session.is_cancelled ? 'completed' : now() < start ? 'upcoming' : now() <= end ? 'live' : 'completed',
      cancelled: session.is_cancelled === true,
      session_key: session.session_key, location: session.location,
      session_name: session.session_name, date_start: session.date_start,
      date_end: session.date_end, ...common,
    });
  };
  const publishTower = () => {
    const rows = [...new Set([...drivers.keys(), ...positions.keys()])].slice(0, 30)
      .map((number) => {
        const position = positions.get(number);
        const interval = intervals.get(number);
        const driver = drivers.get(number);
        const validPosition = position && Number.isInteger(position.position) && position.position > 0;
        return {
          driver: number, pos: validPosition ? position.position : null,
          gap: displayGap(interval?.gap_to_leader), interval: displayGap(interval?.interval),
          full_name: typeof driver?.full_name === 'string' ? driver.full_name.slice(0, 120) : undefined,
          name_acronym: typeof driver?.name_acronym === 'string' ? driver.name_acronym.slice(0, 12) : undefined,
          team_name: typeof driver?.team_name === 'string' ? driver.team_name.slice(0, 120) : undefined,
          team_colour: typeof driver?.team_colour === 'string' && /^[a-fA-F0-9]{6}$/.test(driver.team_colour) ? driver.team_colour : undefined,
        };
      }).sort((left, right) => (left.pos ?? 999) - (right.pos ?? 999));
    if (!rows.length) return;
    const timestamp = timingTimestamp();
    const status = delivery();
    const data = {
      rows, sessionKey: session?.session_key, dataTimestamp: timestamp,
      lastDataAt: timestamp, sourceUpdatedAt: timestamp,
      status, delivery: status, stale: status === 'stale' || status === 'unavailable',
    };
    publish('tower', { ...data, ts: now() }, data);
  };
  const takeRequestSlot = async (signal: AbortSignal) => {
    for (;;) {
      signal.throwIfAborted();
      const current = now();
      while (requestStarts.length && requestStarts[0]! <= current - 60_000) requestStarts.shift();
      const gap = lastRequestAt === null ? 0 : lastRequestAt + requestGapMs - current;
      const quota = requestStarts.length >= requestsPerMinute ? requestStarts[0]! + 60_001 - current : 0;
      const delay = Math.max(0, gap, quota);
      if (!delay) {
        await dependencies.beforeRequest?.(signal);
        signal.throwIfAborted();
        requestStarts.push(now()); lastRequestAt = now(); upstreamRequests += 1; return;
      }
      await wait(delay, signal);
    }
  };
  const options = (signal: AbortSignal, channel: Channel): LiveFetchOptions => {
    const base: LiveFetchOptions = { strict: true, revalidate: 0, signal, timeoutMs: 8_000 };
    if (!session || channel === 'session' || channel === 'drivers') return base;
    const end = sampleTime(session.date_end) ?? now();
    const upper = Math.min(now(), end);
    // Position events are sparse: a driver may hold the same position for many
    // laps. Bootstrap once (provider body/deadline limits still apply), then
    // retain latest-per-driver state and use a short overlap window thereafter.
    const windowMs = channel === 'positions' && !positionBootstrapAttempted
      ? 6 * 60 * 60_000 : channel === 'race_control' ? 30 * 60_000 : 2 * 60_000;
    const lower = Math.max(sampleTime(session.date_start) ?? 0, upper - windowMs);
    return { ...base, dateGte: new Date(lower).toISOString(), dateLte: new Date(upper).toISOString() };
  };
  const due = (channel: Channel) => {
    if (channel !== 'session' && !activeWindow() && loaded.has(channel) && !failures.has(channel)) return false;
    const last = attempts.get(channel);
    const cadence = failures.has(channel) ? Math.max(CADENCE[channel], 60_000) : CADENCE[channel];
    return last === undefined || now() - last >= cadence;
  };
  const pull = async <T,>(channel: Channel, signal: AbortSignal, fetchValue: (opts: LiveFetchOptions) => Promise<T>): Promise<T | null> => {
    await takeRequestSlot(signal);
    attempts.set(channel, now());
    const fetchOptions = options(signal, channel);
    const acquisitionStartedAt = now();
    try {
      const value = await fetchValue(fetchOptions);
      signal.throwIfAborted();
      if (channel === 'positions') positionBootstrapAttempted = true;
      failures.delete(channel); loaded.add(channel);
      settledReads.set(channel, { channel, data: value, succeeded: true, options: fetchOptions, acquisitionStartedAt, acquisitionCompletedAt: now() });
      return value;
    } catch (error) {
      if (signal.aborted) { attempts.delete(channel); throw error; }
      failures.add(channel);
      settledReads.set(channel, { channel, data: null, succeeded: false, options: fetchOptions, acquisitionStartedAt, acquisitionCompletedAt: now() });
      return null;
    } finally {
      await dependencies.afterRequest?.();
    }
  };
  const finishChannel = async (channel: Channel, signal: AbortSignal) => {
    const read = settledReads.get(channel);
    settledReads.delete(channel);
    if (read) await dependencies.onChannelSettled?.(read, signal);
    signal.throwIfAborted();
  };
  const refresh = (signal: AbortSignal): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      if (due('session')) {
        const candidate = await pull('session', signal, (opts) => dependencies.source.getLatestSession(opts));
        const next = cleanSession(candidate);
        sessionFailed = failures.has('session') || (candidate !== null && next === null);
        // Only a successful strict lookup can confirm absence. Failure keeps a
        // known session stale; confirmed absence removes its cached channels.
        if (!sessionFailed && next?.session_key !== session?.session_key) {
          session = next;
          drivers = new Map(); positions = new Map(); intervals = new Map(); raceControl = []; weather = null;
          positionBootstrapAttempted = false;
          for (const channel of Object.keys(CADENCE) as Channel[]) {
            if (channel !== 'session') { attempts.delete(channel); loaded.delete(channel); failures.delete(channel); }
          }
          cached.clear(); signatures.clear();
        } else if (next) session = next;
        publishSession();
        // Same-session cancellation, access loss or a failed session lookup
        // must replace retained timing delivery before a durable partial set
        // is published. The original sample and row values stay unchanged.
        publishTower();
        await finishChannel('session', signal);
      }
      if (!session || session.is_cancelled || now() < (sampleTime(session.date_start) ?? Number.POSITIVE_INFINITY)
        || (protectedWindow() && !dependencies.access().realtimeConfigured)) { publishTower(); publishSession(); return; }
      const key = session.session_key;
      if (due('drivers')) {
        const data = await pull('drivers', signal, (opts) => dependencies.source.getDrivers(key, opts));
        if (data?.length) drivers = new Map(data.filter((item) => item.session_key === key && Number.isInteger(item.driver_number) && item.driver_number > 0 && item.driver_number < 100).slice(0, 30).map((item) => [item.driver_number, item]));
        publishTower();
        await finishChannel('drivers', signal);
      }
      if (due('positions')) {
        const data = await pull('positions', signal, (opts) => dependencies.source.getPositions(key, opts));
        for (const item of data ?? []) {
          const date = sampleTime(item.date);
          const previous = sampleTime(positions.get(item.driver_number)?.date);
          if (item.session_key === key && Number.isInteger(item.driver_number) && item.driver_number > 0 && item.driver_number < 100 && date !== null && date <= now() + 5_000 && (previous === null || date >= previous)) positions.set(item.driver_number, item);
        }
        publishTower(); publishSession();
        await finishChannel('positions', signal);
      }
      if (due('intervals')) {
        const data = await pull('intervals', signal, (opts) => dependencies.source.getIntervals(key, opts));
        for (const item of data ?? []) {
          const date = sampleTime(item.date);
          const previous = sampleTime(intervals.get(item.driver_number)?.date);
          if (item.session_key === key && Number.isInteger(item.driver_number) && item.driver_number > 0 && item.driver_number < 100 && date !== null && date <= now() + 5_000 && (previous === null || date >= previous)) intervals.set(item.driver_number, item);
        }
        publishTower(); publishSession();
        await finishChannel('intervals', signal);
      }
      if (due('race_control')) {
        const data = await pull('race_control', signal, (opts) => dependencies.source.getRaceControl(key, opts));
        if (data !== null) {
          const byIdentity = new Map(raceControl.map((item) => [`${item.date}:${item.message}`, item]));
          for (const item of data) {
            const date = sampleTime(item.date);
            if (item.session_key === key && date !== null && date <= now() + 5_000) {
              const message = String(item.message ?? '').slice(0, 800);
              byIdentity.set(`${item.date}:${message}`, {
                session_key: key, date: item.date, message,
                category: String(item.category ?? '').slice(0, 40),
                flag: typeof item.flag === 'string' ? item.flag.slice(0, 40) : undefined,
                scope: typeof item.scope === 'string' ? item.scope.slice(0, 40) : undefined,
                driver_number: sampleNumber(item.driver_number), lap_number: sampleNumber(item.lap_number), sector: sampleNumber(item.sector),
              });
            }
          }
          raceControl = [...byIdentity.values()].sort((left, right) => Date.parse(left.date) - Date.parse(right.date)).slice(-20);
        }
        const timestamp = sampleTime(raceControl.at(-1)?.date);
        const payload = { messages: raceControl.slice(-3), sessionKey: key, dataTimestamp: timestamp, lastDataAt: timestamp, sourceUpdatedAt: timestamp, stale: failures.has('race_control') };
        publish('race_control', { ...payload, ts: now() }, payload);
        await finishChannel('race_control', signal);
      }
      if (due('weather')) {
        const data = await pull('weather', signal, (opts) => dependencies.source.getWeather(key, opts));
        for (const item of data ?? []) {
          const date = sampleTime(item.date);
          if (item.session_key === key && date !== null && date <= now() + 5_000 && (weather === null || date >= (sampleTime(weather.date) ?? 0))) weather = {
            session_key: key, date: item.date,
            air_temperature: sampleNumber(item.air_temperature), track_temperature: sampleNumber(item.track_temperature),
            humidity: sampleNumber(item.humidity), pressure: sampleNumber(item.pressure),
            wind_speed: sampleNumber(item.wind_speed), wind_direction: sampleNumber(item.wind_direction), rainfall: sampleNumber(item.rainfall),
          };
        }
        if (weather) {
          const timestamp = sampleTime(weather.date);
          const payload = { ...weather, sessionKey: key, dataTimestamp: timestamp, lastDataAt: timestamp, sourceUpdatedAt: timestamp, stale: failures.has('weather') };
          publish('weather', { ...payload, ts: now() }, payload);
        }
        await finishChannel('weather', signal);
      }
      publishTower(); publishSession();
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
  const run = async (signal: AbortSignal) => {
    while (!signal.aborted && listeners.size) {
      try { await refresh(signal); } catch { if (signal.aborted) return; }
      publishTower(); publishSession();
      await wait(1_000, signal);
    }
  };
  const stop = () => {
    abort?.abort(); abort = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };
  return {
    subscribe(listener: (frame: LiveFrame) => void) {
      listeners.add(listener);
      for (const frame of cached.values()) listener(frame);
      if (!abort && policy.automatic !== false) {
        abort = new AbortController();
        heartbeat = setInterval(() => publish('heartbeat', { ts: now() }), 30_000);
        void run(abort.signal);
      }
      let removed = false;
      return () => { if (removed) return; removed = true; listeners.delete(listener); if (!listeners.size) stop(); };
    },
    refresh,
    dispose() { listeners.clear(); stop(); },
    metrics() { return { subscribers: listeners.size, upstreamRequests, retainedFrames: cached.size, running: abort !== null }; },
  };
}
