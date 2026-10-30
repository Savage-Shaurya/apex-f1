import { scopedRedisKey } from '../../../packages/api-client/src/redis-scope';
import { createHash } from 'node:crypto';
import { isProviderUnavailable, untrackedFetch } from '../../../packages/api-client/src/transport';
import { weekendWatchTargets, type RaceTimes, type WatchTarget } from './data-freshness';

/**
 * Race-weekend watch: the job that makes results appear on their own.
 *
 * Every few minutes on race weekends (.github/workflows/refresh-weekend.yml)
 * it asks Jolpica F1, uncached, for each classification that is due
 * (qualifying, sprint, race: ended and inside its window). When a
 * classification is new or changed (stewards' penalties) it revalidates
 * the pages that show it and, for a race, runs the season ingestion so the
 * database and prediction grades follow. Outside those windows it makes one
 * cached calendar read and stops.
 *
 * Change detection uses a fingerprint of the published rows kept in Upstash
 * Redis when configured (14 days). Without it every due, published
 * classification counts as changed, so pages are still refreshed, only more
 * often than needed.
 */

export interface ClassificationRow {
  position?: string;
  positionText?: string;
  points?: string;
  status?: string;
  Driver?: { driverId?: string };
  Time?: { time?: string };
  Q1?: string; Q2?: string; Q3?: string;
}

/** Stable digest of what a page would show; any correction changes it. */
export function classificationFingerprint(rows: readonly ClassificationRow[]): string {
  const canonical = rows.map((row) => [row.position ?? '', row.positionText ?? '', row.Driver?.driverId ?? '', row.points ?? '', row.status ?? '', row.Time?.time ?? '', row.Q1 ?? '', row.Q2 ?? '', row.Q3 ?? '']);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

export interface FingerprintStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export const WATCH_FINGERPRINT_TTL_S = 14 * 86_400;
const PREFIX = scopedRedisKey('apex:weekend-watch:v1:');

export function watchKey(target: Pick<WatchTarget, 'season' | 'round' | 'kind'>): string {
  return `${PREFIX}${target.season}:${target.round}:${target.kind}`;
}

/** Upstash REST store; calls are bounded (2 s) and a failed read counts as "unknown" (treated as changed). */
export function redisFingerprintStore(config: { url: string; token: string }, fetchImpl: typeof fetch = untrackedFetch()): FingerprintStore {
  const call = async (command: string[]): Promise<unknown> => {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error('fingerprint store unavailable');
    return ((await response.json()) as { result?: unknown }).result;
  };
  return {
    async get(key) { const value = await call(['GET', key]); return typeof value === 'string' ? value : null; },
    async set(key, value) { await call(['SET', key, value, 'EX', String(WATCH_FINGERPRINT_TTL_S)]); },
  };
}

export interface WatchRace extends RaceTimes { round: number; routeSlug?: string | null; slug: string }

export interface WeekendWatchDependencies {
  now: number;
  races: readonly WatchRace[];
  /** Uncached strict read of one classification; [] = not published yet. */
  read(target: WatchTarget): Promise<ClassificationRow[]>;
  store: FingerprintStore | null;
  /** Revalidate the pages that show this classification. */
  revalidate(target: WatchTarget, race: WatchRace): Promise<void> | void;
  /** Season ingestion after a new or corrected race classification (database configured only). Returns true when stored. */
  ingest?(target: WatchTarget): Promise<boolean>;
  /** Stop between targets when the job's time is nearly spent. */
  hasTime?(): boolean;
}

export interface WeekendWatchReport {
  due: number;
  checked: number;
  pending: string[];
  changed: string[];
  unchanged: string[];
  ingested: string[];
  errors: string[];
  /** How many of `errors` were only the provider being unavailable (timeouts, 429, 5xx, edge errors). */
  unavailable: number;
  deferred: number;
}

const label = (t: WatchTarget) => `${t.season}/${t.round}/${t.kind}`;

export async function runWeekendWatch(deps: WeekendWatchDependencies): Promise<WeekendWatchReport> {
  const targets = weekendWatchTargets(deps.races, deps.now);
  const report: WeekendWatchReport = { due: targets.length, checked: 0, pending: [], changed: [], unchanged: [], ingested: [], errors: [], unavailable: 0, deferred: 0 };
  for (const [index, target] of targets.entries()) {
    if (deps.hasTime && !deps.hasTime()) { report.deferred = targets.length - index; break; }
    const race = deps.races.find((r) => r.season === target.season && r.round === target.round)!;
    let rows: ClassificationRow[];
    try { rows = await deps.read(target); }
    catch (error) {
      // Only the provider's short error code is reported (never a message, URL or payload).
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[a-z-]{1,40}$/.test(error.code) ? error.code : 'error';
      report.errors.push(`${label(target)}: classification could not be read (${code}); the next run retries.`);
      if (isProviderUnavailable(error)) report.unavailable++;
      continue;
    }
    report.checked++;
    if (!rows.length) { report.pending.push(label(target)); continue; }
    const fingerprint = classificationFingerprint(rows);
    let stored: string | null = null;
    try { stored = deps.store ? await deps.store.get(watchKey(target)) : null; } catch { stored = null; }
    const [storedPrint, storedIngested] = (stored ?? '').split(':');
    const changed = storedPrint !== fingerprint;
    if (changed) {
      await deps.revalidate(target, race);
      report.changed.push(label(target));
    } else report.unchanged.push(label(target));
    // A race classification goes into the database once per fingerprint (retried until it lands).
    let ingested = storedIngested === '1' && !changed;
    if (target.kind === 'R' && deps.ingest && !ingested) {
      try { ingested = await deps.ingest(target); if (ingested) report.ingested.push(label(target)); }
      catch { report.errors.push(`${label(target)}: ingestion failed; previous verified data was kept and the next run retries.`); }
    }
    if (deps.store && (changed || ingested !== (storedIngested === '1'))) {
      try { await deps.store.set(watchKey(target), `${fingerprint}:${ingested ? '1' : '0'}`); }
      catch { /* best effort: an unknown fingerprint only means one more revalidation */ }
    }
  }
  return report;
}

/** Pages showing a classification: the race page and home always; standings and season pages for a race or sprint. */
export function pathsFor(target: Pick<WatchTarget, 'season' | 'kind'>, race: Pick<WatchRace, 'routeSlug' | 'slug'>): string[] {
  const paths = ['/', `/schedule/${target.season}/${race.routeSlug ?? race.slug}`];
  if (target.kind !== 'Q') paths.push('/schedule', `/schedule/${target.season}`, `/results/${target.season}/drivers`, `/results/${target.season}/teams`, '/drivers', '/teams');
  if (target.kind === 'Q' || target.kind === 'R') paths.push('/predict');
  return paths;
}
