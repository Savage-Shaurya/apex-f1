'use client';

import { createContext, useEffect, useState, type ReactNode } from 'react';
import { mergeRaceControlMessages } from '@/components/live/LiveDataHelpers';
import type {
  LiveDelivery, LiveRaceControlMsg, LiveSessionState, LiveStreamSnapshot, LiveTowerRow,
  LiveWeather,
} from '@/components/live/LiveStreamHook';

export const INITIAL_LIVE_SNAPSHOT: LiveStreamSnapshot = {
  connection: 'connecting', session: null, tower: null, raceControl: null,
  weather: null, lastError: null, lastFrameAt: null, lastDataAt: null,
};

export const LiveStreamContext = createContext<LiveStreamSnapshot | null>(null);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sampleTimestamp(data: Record<string, unknown>): number | null {
  return timestamp(data.dataTimestamp) ?? timestamp(data.lastDataAt) ?? timestamp(data.sourceUpdatedAt);
}

function delivery(value: unknown): LiveDelivery | undefined {
  return value === 'live' || value === 'snapshot' || value === 'stale' || value === 'unavailable'
    ? value : undefined;
}

function sessionKey(session: LiveSessionState | null): number | null {
  return session && session.state !== 'no_session' ? session.session_key : null;
}

function towerRow(value: unknown): LiveTowerRow | null {
  const row = record(value);
  if (!row || !Number.isInteger(row.driver) || Number(row.driver) <= 0
    || (row.pos != null && (!Number.isInteger(row.pos) || Number(row.pos) <= 0))) return null;
  const parsed: LiveTowerRow = { driver: Number(row.driver) };
  if (row.pos != null) parsed.pos = Number(row.pos);
  for (const field of ['gap', 'interval'] as const) {
    const value = row[field];
    if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) parsed[field] = value;
  }
  for (const field of ['full_name', 'name_acronym', 'team_name', 'team_colour', 'compound'] as const) {
    if (typeof row[field] === 'string') parsed[field] = row[field];
  }
  if (typeof row.stintLap === 'number' && Number.isFinite(row.stintLap)) parsed.stintLap = row.stintLap;
  return parsed;
}

function raceControlMessage(value: unknown): LiveRaceControlMsg | null {
  const message = record(value);
  if (!message || typeof message.date !== 'string' || !Number.isFinite(Date.parse(message.date))
    || typeof message.message !== 'string' || typeof message.category !== 'string') return null;
  const parsed: LiveRaceControlMsg = { date: message.date, message: message.message, category: message.category };
  for (const field of ['flag', 'scope'] as const) if (typeof message[field] === 'string') parsed[field] = message[field];
  for (const field of ['driver_number', 'lap_number', 'sector'] as const) {
    if (typeof message[field] === 'number' && Number.isFinite(message[field])) parsed[field] = message[field];
  }
  return parsed;
}

/** One connection for the route tree; hidden tabs release their server stream. */
export function LiveStreamProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<LiveStreamSnapshot>(INITIAL_LIVE_SNAPSHOT);

  useEffect(() => {
    let source: EventSource | null = null;
    let disposed = false;
    let towerSignature = '';
    let controlSignature = '';
    let weatherSignature = '';
    let knownSessionKey: number | null = null;

    const close = () => { source?.close(); source = null; };
    const open = () => {
      if (disposed || document.hidden || source) return;
      if (typeof EventSource === 'undefined') {
        setSnapshot((prev) => ({ ...prev, connection: 'closed', lastError: 'Live updates are unavailable in this browser.' }));
        return;
      }
      setSnapshot((prev) => ({ ...prev, connection: 'connecting' }));
      const stream = new EventSource('/api/live/stream');
      source = stream;
      const current = () => !disposed && source === stream;
      const on = (name: string, handler: (data: Record<string, unknown>) => void) => {
        stream.addEventListener(name, (event) => {
          if (!current() || !('data' in event) || typeof event.data !== 'string') return;
          try {
            const data = record(JSON.parse(event.data));
            if (data) handler(data);
          } catch { /* Invalid upstream frames never replace a known snapshot. */ }
        });
      };
      stream.addEventListener('open', () => {
        if (current()) setSnapshot((prev) => ({ ...prev, connection: 'open', lastError: null }));
      });
      stream.addEventListener('error', (event) => {
        if (!current() || 'data' in event) return;
        setSnapshot((prev) => ({
          ...prev, connection: stream.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting',
          lastError: 'Connection interrupted. Waiting to reconnect.',
        }));
      });
      on('connected', () => setSnapshot((prev) => ({ ...prev, connection: 'open', lastError: null, lastFrameAt: Date.now() })));
      on('heartbeat', () => setSnapshot((prev) => ({ ...prev, lastFrameAt: Date.now() })));
      on('session_state', (data) => {
        let session: LiveSessionState;
        const mode = delivery(data.delivery ?? data.status);
        const detail = typeof data.detail === 'string' ? data.detail : undefined;
        if (data.state === 'no_session') session = { state: 'no_session', delivery: mode, detail };
        else {
          if (!['live', 'upcoming', 'completed'].includes(String(data.state))
            || !Number.isInteger(data.session_key) || Number(data.session_key) <= 0 || typeof data.location !== 'string'
            || typeof data.session_name !== 'string' || typeof data.date_start !== 'string'
            || typeof data.date_end !== 'string' || !Number.isFinite(Date.parse(data.date_start))
            || !Number.isFinite(Date.parse(data.date_end))) return;
          session = {
            state: data.state as 'live' | 'upcoming' | 'completed', session_key: Number(data.session_key),
            location: data.location, session_name: data.session_name, date_start: data.date_start,
            date_end: data.date_end, delivery: mode, detail,
            realtimeAvailable: typeof data.realtimeAvailable === 'boolean' ? data.realtimeAvailable : undefined,
            sourceUpdatedAt: sampleTimestamp(data),
          };
        }
        const changed = knownSessionKey !== sessionKey(session);
        knownSessionKey = sessionKey(session);
        if (changed) { towerSignature = ''; controlSignature = ''; weatherSignature = ''; }
        setSnapshot((prev) => ({
          ...prev, session, lastFrameAt: Date.now(),
          ...(changed ? { tower: null, raceControl: null, weather: null, lastDataAt: null, lastError: null } : {}),
        }));
      });
      on('tower', (data) => {
        if (data.sessionKey !== undefined && data.sessionKey !== knownSessionKey) return;
        if (!Array.isArray(data.rows)) return;
        const rows = data.rows.map(towerRow).filter((row): row is LiveTowerRow => row !== null);
        const dataTimestamp = sampleTimestamp(data);
        const stale = data.stale === true;
        const signature = JSON.stringify([rows, dataTimestamp, stale]);
        if (signature === towerSignature) return;
        towerSignature = signature;
        setSnapshot((prev) => {
          const merged = new Map((prev.tower?.rows ?? []).map((row) => [row.driver, row]));
          for (const row of rows) merged.set(row.driver, { ...merged.get(row.driver), ...row });
          return {
            ...prev, tower: { rows: Array.from(merged.values()), ts: timestamp(data.ts) ?? 0, dataTimestamp, stale },
            lastFrameAt: Date.now(), lastDataAt: dataTimestamp ?? prev.lastDataAt,
            lastError: stale ? prev.lastError : null,
          };
        });
      });
      on('race_control', (data) => {
        if (data.sessionKey !== undefined && data.sessionKey !== knownSessionKey) return;
        if (!Array.isArray(data.messages)) return;
        const messages = data.messages.map(raceControlMessage).filter((message): message is LiveRaceControlMsg => message !== null);
        const dataTimestamp = sampleTimestamp(data)
          ?? (messages.length ? Math.max(...messages.map((message) => Date.parse(message.date))) : null);
        const stale = data.stale === true;
        const signature = JSON.stringify([messages, dataTimestamp, stale]);
        if (signature === controlSignature) return;
        controlSignature = signature;
        setSnapshot((prev) => ({
          ...prev, raceControl: { messages: mergeRaceControlMessages(prev.raceControl?.messages ?? [], messages), ts: timestamp(data.ts) ?? 0, dataTimestamp, stale },
          lastFrameAt: Date.now(),
        }));
      });
      on('weather', (data) => {
        if (data.sessionKey !== undefined && data.sessionKey !== knownSessionKey) return;
        const dataTimestamp = sampleTimestamp(data)
          ?? (typeof data.date === 'string' ? timestamp(Date.parse(data.date)) : null);
        const weather: LiveWeather = { ts: timestamp(data.ts) ?? 0, dataTimestamp, stale: data.stale === true };
        for (const field of ['air_temperature', 'track_temperature', 'rainfall', 'humidity', 'pressure', 'wind_speed', 'wind_direction'] as const) {
          if (typeof data[field] === 'number' && Number.isFinite(data[field])) weather[field] = data[field];
        }
        if (typeof data.date === 'string') weather.date = data.date;
        const signature = JSON.stringify({ ...weather, ts: undefined });
        if (signature === weatherSignature) return;
        weatherSignature = signature;
        setSnapshot((prev) => ({ ...prev, weather, lastFrameAt: Date.now() }));
      });
      on('error', (data) => {
        setSnapshot((prev) => ({ ...prev, lastError: typeof data.message === 'string' ? data.message : 'Live data is unavailable.', lastFrameAt: Date.now() }));
      });
    };
    const onVisibility = () => {
      if (document.hidden) {
        close();
        setSnapshot((prev) => ({ ...prev, connection: 'paused' }));
      } else open();
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => { disposed = true; close(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  return <LiveStreamContext.Provider value={snapshot}>{children}</LiveStreamContext.Provider>;
}
