'use client';

import { useContext } from 'react';
import { LiveStreamContext, INITIAL_LIVE_SNAPSHOT } from '@/context/LiveStreamProvider';

export type LiveDelivery = 'live' | 'snapshot' | 'stale' | 'unavailable';
export type LiveSessionState =
  | { state: 'no_session'; delivery?: LiveDelivery; detail?: string }
  | {
      state: 'live' | 'upcoming' | 'completed';
      session_key: number;
      location: string;
      session_name: string;
      date_start: string;
      date_end: string;
      delivery?: LiveDelivery;
      realtimeAvailable?: boolean;
      detail?: string;
      sourceUpdatedAt?: number | null;
    };

export interface LiveTowerRow {
  driver: number;
  pos?: number | null;
  gap?: number | string | null;
  interval?: number | string | null;
  full_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  compound?: string;
  stintLap?: number;
}

export interface LiveTower {
  rows: LiveTowerRow[];
  ts: number;
  dataTimestamp: number | null;
  stale?: boolean;
}

export interface LiveRaceControlMsg {
  date: string;
  category: string;
  flag?: string;
  message: string;
  driver_number?: number;
  lap_number?: number;
  sector?: number;
  scope?: string;
}

export interface LiveRaceControl {
  messages: LiveRaceControlMsg[];
  ts: number;
  dataTimestamp: number | null;
  stale?: boolean;
}

export interface LiveWeather {
  air_temperature?: number;
  track_temperature?: number;
  rainfall?: number;
  humidity?: number;
  pressure?: number;
  wind_speed?: number;
  wind_direction?: number;
  date?: string;
  ts: number;
  dataTimestamp: number | null;
  stale?: boolean;
}

export interface LiveStreamSnapshot {
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'paused';
  session: LiveSessionState | null;
  tower: LiveTower | null;
  raceControl: LiveRaceControl | null;
  weather: LiveWeather | null;
  lastError: string | null;
  /** Transport arrival only; a heartbeat does not establish data freshness. */
  lastFrameAt: number | null;
  /** Timestamp from the upstream sample, never the local poll/heartbeat time. */
  lastDataAt: number | null;
}

/** All /live routes share the subscription mounted by their layout. */
export function useLiveStream(): LiveStreamSnapshot {
  return useContext(LiveStreamContext) ?? INITIAL_LIVE_SNAPSHOT;
}
