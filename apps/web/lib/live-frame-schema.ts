import type { LiveEventName, LiveFrame } from './live-session-hub';

export const MAX_LIVE_FRAME_BYTES = 32_768;
export const MAX_LIVE_SNAPSHOT_BYTES = 131_072;
const encoder = new TextEncoder();
const events = new Set<LiveEventName>(['session_state', 'tower', 'race_control', 'weather']);
const deliveries = new Set(['live', 'snapshot', 'stale', 'unavailable']);
const states = new Set(['no_session', 'upcoming', 'live', 'completed']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, length: number) => typeof value === 'string' ? value.slice(0, length) : undefined;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const key = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
const instant = (value: unknown) => typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value)) ? value : undefined;
const gap = (value: unknown) => value === null ? null : typeof value === 'string' ? value.slice(0, 40) : number(value);

/** A shared store never becomes a conduit for arbitrary provider fields. */
export function sanitizeLiveFrame(value: unknown): LiveFrame | null {
  if (!record(value) || !events.has(value.event as LiveEventName) || !record(value.data)) return null;
  const event = value.event as LiveEventName;
  const input = value.data;
  const data: Record<string, unknown> = {};
  for (const field of ['dataTimestamp', 'lastDataAt', 'sourceUpdatedAt', 'ts']) {
    if (input[field] === null) data[field] = null;
    else if (number(input[field]) !== undefined) data[field] = input[field];
  }
  for (const field of ['status', 'delivery']) if (deliveries.has(input[field] as string)) data[field] = input[field];
  if (event === 'session_state' || event === 'tower') {
    const delivery = deliveries.has(input.delivery as string) ? input.delivery : 'unavailable';
    data.delivery = delivery;
    data.status = delivery;
  }
  if (typeof input.stale === 'boolean') data.stale = input.stale;
  if (key(input.sessionKey)) data.sessionKey = input.sessionKey;
  if (event === 'session_state') {
    if (!states.has(input.state as string)) return null;
    data.state = input.state;
    if (key(input.session_key)) data.session_key = input.session_key;
    for (const field of ['location', 'session_name']) data[field] = text(input[field], 200);
    for (const field of ['date_start', 'date_end']) data[field] = instant(input[field]);
    if (typeof input.realtimeAvailable === 'boolean') data.realtimeAvailable = input.realtimeAvailable;
    if (typeof input.cancelled === 'boolean') data.cancelled = input.cancelled;
    data.detail = text(input.detail, 400);
  } else if (event === 'tower') {
    if (!Array.isArray(input.rows)) return null;
    data.rows = input.rows.slice(0, 30).filter(record).filter((row) => key(row.driver) && (row.driver as number) < 100).map((row) => ({
      driver: row.driver, pos: key(row.pos) && (row.pos as number) <= 30 ? row.pos : null,
      gap: gap(row.gap), interval: gap(row.interval), full_name: text(row.full_name, 120),
      name_acronym: text(row.name_acronym, 12), team_name: text(row.team_name, 120),
      team_colour: typeof row.team_colour === 'string' && /^[a-fA-F0-9]{6}$/.test(row.team_colour) ? row.team_colour : undefined,
    }));
  } else if (event === 'race_control') {
    if (!Array.isArray(input.messages)) return null;
    data.messages = input.messages.slice(-3).filter(record).filter((message) => key(message.session_key) && instant(message.date)).map((message) => ({
      session_key: message.session_key, date: message.date, message: text(message.message, 800),
      category: text(message.category, 40), flag: text(message.flag, 40), scope: text(message.scope, 40),
      driver_number: number(message.driver_number), lap_number: number(message.lap_number), sector: number(message.sector),
    }));
  } else {
    if (key(input.session_key)) data.session_key = input.session_key;
    data.date = instant(input.date);
    for (const field of ['air_temperature', 'track_temperature', 'humidity', 'pressure', 'wind_speed', 'wind_direction', 'rainfall']) data[field] = number(input[field]);
  }
  // Remove undefined fields and guarantee the result is detached JSON data.
  const frame = JSON.parse(JSON.stringify({ event, data })) as LiveFrame;
  return encoder.encode(JSON.stringify(frame)).byteLength <= MAX_LIVE_FRAME_BYTES ? frame : null;
}

export function sanitizeLiveFrames(value: unknown): LiveFrame[] | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  const frames = value.map(sanitizeLiveFrame);
  if (frames.some((frame) => frame === null)) return null;
  const clean = frames as LiveFrame[];
  if (new Set(clean.map((frame) => frame.event)).size !== clean.length) return null;
  const session = clean.find((frame) => frame.event === 'session_state');
  const expectedKey = session?.data.session_key;
  if (session) {
    for (const frame of clean) {
      if (frame.event === 'session_state') continue;
      if (!key(expectedKey) || frame.data.sessionKey !== expectedKey) return null;
      if (frame.event === 'weather' && frame.data.session_key !== expectedKey) return null;
      if (frame.event === 'race_control' && (frame.data.messages as Array<Record<string, unknown>>).some((message) => message.session_key !== expectedKey)) return null;
    }
  }
  return encoder.encode(JSON.stringify(clean)).byteLength <= MAX_LIVE_SNAPSHOT_BYTES ? clean : null;
}
