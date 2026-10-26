import { openf1 } from '@apex/api-client/openf1';

type DiagnosticSource = Pick<typeof openf1, 'getLatestSession' | 'getIntervals' | 'getPositions' | 'getWeather' | 'getRaceControl'>;
export interface DiagnosticOptions {
  source?: DiagnosticSource;
  signal?: AbortSignal;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
const waitForRequest = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(new Error('Diagnostic deadline reached.')); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
});

/** One bounded provider diagnostic. The web server's shared hub owns live polling. */
export async function runOpenF1Diagnostic(options: DiagnosticOptions = {}) {
  const source = options.source ?? openf1;
  const signal = options.signal ?? AbortSignal.timeout(35_000);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForRequest;
  const base = { strict: true, revalidate: 0, signal, timeoutMs: 5_000, maxBytes: 250_000 };
  signal.throwIfAborted();
  const session = await source.getLatestSession(base);
  if (!session) return { mode: 'diagnostic' as const, status: 'no-session' as const };
  const start = Date.parse(session.date_start), end = Date.parse(session.date_end);
  if (!Number.isSafeInteger(session.session_key) || session.session_key <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid provider session metadata.');
  if (start > now()) return { mode: 'diagnostic' as const, status: 'scheduled' as const, sessionKey: session.session_key };
  const upper = Math.min(end, now()), lower = Math.max(start, upper - 120_000);
  const request = { ...base, dateGte: new Date(lower).toISOString(), dateLte: new Date(upper).toISOString() };
  const once = async <T>(read: () => Promise<T>) => { await wait(2_500, signal); signal.throwIfAborted(); return read(); };
  const intervals = await once(() => source.getIntervals(session.session_key, request));
  const positions = await once(() => source.getPositions(session.session_key, request));
  const raceControl = await once(() => source.getRaceControl(session.session_key, request));
  const weather = await once(() => source.getWeather(session.session_key, request));
  return { mode: 'diagnostic' as const, status: 'sampled' as const, sessionKey: session.session_key,
    sampledAt: new Date(now()).toISOString(), window: { start: request.dateGte, end: request.dateLte },
    counts: { intervals: intervals.length, positions: positions.length, raceControl: raceControl.length, weather: weather.length } };
}
