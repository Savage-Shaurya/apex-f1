import { createHash } from 'node:crypto';
import { openf1, type FetchOpts } from '@apex/api-client/openf1';
import { ProviderError } from '../../../packages/api-client/src/transport';

export const MAX_LIVE_SOURCE_BYTES = 1_000_000;
export type LiveSourceEndpoint = 'sessions' | 'drivers' | 'position' | 'intervals' | 'stints' | 'weather' | 'race_control';
export interface LiveSourceIdentity { endpoint: LiveSourceEndpoint; sessionKey: number | 'latest' }
export interface LiveSourceAcquisition {
  acquisitionStartedAt: number;
  acquisitionCompletedAt: number;
  coverageLower: string | null;
  coverageUpper: string | null;
}
export interface LiveSourcePositionCarry extends LiveSourceAcquisition { row: Record<string, unknown> }
export interface LiveSourceSnapshot extends LiveSourceIdentity, LiveSourceAcquisition {
  version: 1;
  kind: 'live-source';
  query: string;
  rows: unknown[];
  /** Sparse positions retain original records and their original request
   * provenance. These records do not extend the current response's coverage. */
  positionCarry?: LiveSourcePositionCarry[];
}
const fields: Record<LiveSourceEndpoint, readonly string[]> = {
  sessions: ['session_key', 'meeting_key', 'session_type', 'session_name', 'date_start', 'date_end', 'circuit_key', 'circuit_short_name', 'country_code', 'country_name', 'location', 'gmt_offset', 'year', 'is_cancelled'],
  drivers: ['session_key', 'meeting_key', 'driver_number', 'full_name', 'name_acronym', 'team_name', 'team_colour', 'country_code', 'headshot_url', 'first_name', 'last_name', 'broadcast_name'],
  position: ['session_key', 'meeting_key', 'driver_number', 'date', 'position'],
  intervals: ['session_key', 'meeting_key', 'driver_number', 'date', 'interval', 'gap_to_leader'],
  stints: ['session_key', 'meeting_key', 'driver_number', 'stint_number', 'compound', 'lap_start', 'lap_end', 'tyre_age_at_start'],
  weather: ['session_key', 'meeting_key', 'date', 'air_temperature', 'track_temperature', 'humidity', 'pressure', 'wind_speed', 'wind_direction', 'rainfall'],
  race_control: ['session_key', 'meeting_key', 'date', 'category', 'message', 'flag', 'scope', 'driver_number', 'lap_number', 'sector'],
};
const freshness: Record<LiveSourceEndpoint, number> = { sessions: 30_000, drivers: 60_000, position: 30_000, intervals: 30_000, stints: 60_000, weather: 60_000, race_control: 30_000 };
const invalid = () => new ProviderError('openf1', 'invalid-response');
function identityValid(identity: LiveSourceIdentity): boolean {
  return identity !== null && typeof identity === 'object' && Object.hasOwn(fields, identity.endpoint)
    && (identity.endpoint === 'sessions' ? identity.sessionKey === 'latest' : typeof identity.sessionKey === 'number' && Number.isSafeInteger(identity.sessionKey) && identity.sessionKey > 0);
}
export function liveSourceQuery(endpoint: LiveSourceEndpoint, sessionKey: number | 'latest'): string {
  if (!identityValid({ endpoint, sessionKey })) throw new ProviderError('openf1', 'invalid-input');
  return createHash('sha256').update(JSON.stringify(['live-source-snapshot', 1, endpoint, sessionKey])).digest('hex');
}
export function liveSourceFreshnessMs(endpoint: LiveSourceEndpoint): number {
  if (!Object.hasOwn(freshness, endpoint)) throw new ProviderError('openf1', 'invalid-input');
  return freshness[endpoint];
}
export function liveSourceRefreshAfterMs(endpoint: LiveSourceEndpoint): number { return liveSourceFreshnessMs(endpoint) / 2; }
function canonicalBound(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw invalid();
  if (new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10)) throw invalid();
  // The actual client encodes provider date filters at UTC-second precision.
  return new Date(value).toISOString().slice(0, 19) + 'Z';
}
function acquisitionValid(value: LiveSourceAcquisition, endpoint: LiveSourceEndpoint, now: number, enforceFreshness: boolean): void {
  if (!Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(value.acquisitionStartedAt) || value.acquisitionStartedAt <= 0
    || !Number.isSafeInteger(value.acquisitionCompletedAt) || value.acquisitionCompletedAt < value.acquisitionStartedAt || value.acquisitionCompletedAt > now + 5_000) throw invalid();
  if ((value.coverageLower === null) !== (value.coverageUpper === null)) throw invalid();
  if (value.coverageLower !== null) {
    if (!['position', 'intervals', 'weather', 'race_control'].includes(endpoint)
      || canonicalBound(value.coverageLower) !== value.coverageLower || canonicalBound(value.coverageUpper!) !== value.coverageUpper
      || Date.parse(value.coverageLower) >= Date.parse(value.coverageUpper!) || Date.parse(value.coverageUpper!) > value.acquisitionStartedAt + 5_000) throw invalid();
  }
  if (enforceFreshness && now - value.acquisitionStartedAt >= liveSourceFreshnessMs(endpoint)) throw new ProviderError('openf1', 'incomplete');
}
function bounded(value: unknown, maxBytes = MAX_LIVE_SOURCE_BYTES): void {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { throw invalid(); }
  if (bytes > maxBytes) throw invalid();
}
function rowFields(endpoint: LiveSourceEndpoint, rows: unknown[], stripUnknown: boolean): Record<string, unknown>[] {
  if (!Array.isArray(rows) || rows.length > 10000 || (endpoint === 'sessions' && rows.length > 1)) throw invalid();
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid();
    const result: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(row)) {
      if (!fields[endpoint].includes(field)) { if (!stripUnknown) throw invalid(); continue; }
      if (value === undefined) continue;
      if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw invalid();
      if ((typeof value === 'string' && value.length > 4000) || (typeof value === 'number' && !Number.isFinite(value))) throw invalid();
      result[field] = value;
    }
    return result;
  });
}
async function strictRows(identity: LiveSourceIdentity, rows: unknown[], acquisition: LiveSourceAcquisition, now: number, signal?: AbortSignal, maxBytes = MAX_LIVE_SOURCE_BYTES): Promise<void> {
  if (signal?.aborted) throw new ProviderError('openf1', 'incomplete');
  bounded(rows, maxBytes);
  const options: FetchOpts = { strict: true, revalidate: 0, timeoutMs: 6000, maxBytes, signal,
    ...(acquisition.coverageLower === null ? {} : { dateGte: acquisition.coverageLower!, dateLte: acquisition.coverageUpper! }),
    fetchImpl: async () => Response.json(rows),
  };
  const key = identity.sessionKey as number;
  switch (identity.endpoint) {
    case 'sessions': await openf1.getLatestSession(options); break;
    case 'drivers': await openf1.getDrivers(key, options); break;
    case 'position': await openf1.getPositions(key, options); break;
    case 'intervals': await openf1.getIntervals(key, options); break;
    case 'stints': await openf1.getStints(key, options); break;
    case 'weather': await openf1.getWeather(key, options); break;
    case 'race_control': await openf1.getRaceControl(key, options); break;
  }
  // Scheduled sessions may legitimately be in the future. Telemetry may not.
  if (identity.endpoint !== 'sessions') for (const row of rows) {
    const value = row as Record<string, unknown>;
    for (const field of ['date', 'date_start']) if (typeof value[field] === 'string') {
      const date = value[field] as string;
      if (Date.parse(date) > Math.min(now, acquisition.acquisitionCompletedAt) + 5000
        || (/^\d{4}-\d{2}-\d{2}T/.test(date) && new Date(date.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== date.slice(0, 10))) throw invalid();
    }
  }
  if (signal?.aborted) throw new ProviderError('openf1', 'incomplete');
}
export async function validateLiveSourceSnapshot(value: unknown, identity: LiveSourceIdentity, now = Date.now(), signal?: AbortSignal): Promise<LiveSourceSnapshot> {
  if (!identityValid(identity) || !value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const snapshot = value as LiveSourceSnapshot;
  if (snapshot.version !== 1 || snapshot.kind !== 'live-source' || snapshot.query !== liveSourceQuery(identity.endpoint, identity.sessionKey)
    || snapshot.endpoint !== identity.endpoint || snapshot.sessionKey !== identity.sessionKey
    || Object.keys(snapshot).some(key => !['version', 'kind', 'query', 'endpoint', 'sessionKey', 'acquisitionStartedAt', 'acquisitionCompletedAt', 'coverageLower', 'coverageUpper', 'rows', 'positionCarry'].includes(key))) throw invalid();
  bounded(snapshot); acquisitionValid(snapshot, identity.endpoint, now, true);
  rowFields(identity.endpoint, snapshot.rows, false);
  await strictRows(identity, snapshot.rows, snapshot, now, signal);
  if (snapshot.positionCarry !== undefined) {
    if (identity.endpoint !== 'position' || !Array.isArray(snapshot.positionCarry) || snapshot.positionCarry.length > 30 || snapshot.rows.length + snapshot.positionCarry.length > 10000) throw invalid();
    const drivers = new Set<number>();
    for (const item of snapshot.positionCarry) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['row', 'acquisitionStartedAt', 'acquisitionCompletedAt', 'coverageLower', 'coverageUpper'].includes(key))) throw invalid();
      acquisitionValid(item, 'position', now, false);
      if (item.acquisitionCompletedAt > snapshot.acquisitionCompletedAt || item.acquisitionStartedAt > snapshot.acquisitionStartedAt) throw invalid();
      rowFields('position', [item.row], false);
      await strictRows(identity, [item.row], item, now, signal);
      const number = item.row.driver_number as number;
      if (drivers.has(number)) throw invalid(); drivers.add(number);
    }
  }
  return snapshot;
}
export async function createLiveSourceSnapshot(identity: LiveSourceIdentity, rows: unknown[], acquisition: LiveSourceAcquisition, now = Date.now(), signal?: AbortSignal): Promise<LiveSourceSnapshot> {
  if (!identityValid(identity)) throw new ProviderError('openf1', 'invalid-input');
  const metadata = { ...acquisition, coverageLower: acquisition.coverageLower === null ? null : canonicalBound(acquisition.coverageLower), coverageUpper: acquisition.coverageUpper === null ? null : canonicalBound(acquisition.coverageUpper) };
  acquisitionValid(metadata, identity.endpoint, now, true);
  // Validate the COMPLETE raw response before removing any undeclared fields.
  if (!Array.isArray(rows) || (identity.endpoint !== 'position' && rows.length > 10000)) throw invalid();
  await strictRows(identity, rows, metadata, now, signal, identity.endpoint === 'position' ? 8_000_000 : MAX_LIVE_SOURCE_BYTES);
  let durableRows = rows;
  if (identity.endpoint === 'position') {
    // A bounded provider history can exceed the durable cache's row/byte limit.
    // Validate every original record FIRST, then retain each driver's newest
    // original row. This is an explicit latest snapshot, never a history API.
    const latest = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      const item = row as Record<string, unknown>, driver = item.driver_number as number;
      const previous = latest.get(driver);
      if (!previous || Date.parse(item.date as string) > Date.parse(previous.date as string)) latest.set(driver, item);
    }
    if (latest.size > 30) throw invalid();
    durableRows = [...latest.values()];
  }
  const snapshot: LiveSourceSnapshot = { version: 1, kind: 'live-source', query: liveSourceQuery(identity.endpoint, identity.sessionKey), ...identity, ...metadata, rows: rowFields(identity.endpoint, durableRows, true) };
  return validateLiveSourceSnapshot(snapshot, identity, now, signal);
}
export function liveSourceSnapshotRows(snapshot: LiveSourceSnapshot): unknown[] {
  return [...(snapshot.positionCarry?.map(item => item.row) ?? []), ...snapshot.rows];
}
export async function mergeLivePositionSnapshots(previous: LiveSourceSnapshot | null, next: LiveSourceSnapshot, now = Date.now(), signal?: AbortSignal): Promise<LiveSourceSnapshot> {
  const identity: LiveSourceIdentity = { endpoint: 'position', sessionKey: next.sessionKey };
  await validateLiveSourceSnapshot(next, identity, now, signal);
  if (!previous) return next;
  // The previous acquisition may be older than the current freshness ceiling:
  // sparse positions remain original state, not newly acquired telemetry.
  if (previous.endpoint !== 'position' || previous.sessionKey !== next.sessionKey || previous.query !== next.query
    || previous.acquisitionStartedAt > next.acquisitionStartedAt || previous.acquisitionCompletedAt > next.acquisitionCompletedAt) throw invalid();
  await validateLiveSourceSnapshot(previous, identity, previous.acquisitionCompletedAt, signal);
  const retained = new Map<number, LiveSourcePositionCarry>();
  const retain = (item: LiveSourcePositionCarry) => {
    const number = item.row.driver_number as number, existing = retained.get(number);
    if (!existing || Date.parse(String(item.row.date)) > Date.parse(String(existing.row.date))) retained.set(number, item);
  };
  for (const item of previous.positionCarry ?? []) retain(item);
  for (const row of previous.rows) retain({ acquisitionStartedAt: previous.acquisitionStartedAt, acquisitionCompletedAt: previous.acquisitionCompletedAt, coverageLower: previous.coverageLower, coverageUpper: previous.coverageUpper, row: row as Record<string, unknown> });
  // Preserve one original earlier state per driver, even when this response has
  // a newer row: asOf consumers can choose it without inventing history.
  if (retained.size > 30) throw invalid();
  const merged: LiveSourceSnapshot = { ...next, positionCarry: [...retained.values()] };
  return validateLiveSourceSnapshot(merged, identity, now, signal);
}
