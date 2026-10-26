/**
 * Pure geometry for the lap trace drawn over a real circuit outline
 * (CircuitStreak). Every comet path uses `pathLength={PATH_UNITS}`, so dash
 * lengths and offsets are fractions of a lap, whatever the circuit's length
 * in pixels, and the dash period equals the lap: a tail that reaches back past
 * the start line wraps across it with no gap and no jump.
 */

/** Normalised lap length used for every dash (`pathLength`). */
export const PATH_UNITS = 1000;
/** One lap of the trace, in ms. Decoration only: it is not a lap time. */
export const LAP_MS = 7500;
/** Tail length as a fraction of the lap. */
export const TAIL = 0.15;
/** Where the head sits on first paint: just past the start/finish line. */
export const START_HEAD = 0.06 * PATH_UNITS;
/** Longest step the clock takes in one frame (ms): a resumed tab or a long frame never makes the trace leap. */
export const MAX_STEP_MS = 50;

export type Point = [number, number];
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Points of an absolute M/L/Z polyline path (the form `circuitPath` produces). */
export function pathPoints(d: string): Point[] {
  const nums = d.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i]!, nums[i + 1]!]);
  return pts;
}

export function pointsBounds(pts: readonly Point[]): Bounds | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const trim = (n: number) => Number(n.toFixed(3));

/**
 * viewBox around the outline with the same padding on every side. With the
 * default `preserveAspectRatio` (xMidYMid meet) the circuit is then centred
 * and as large as its box allows, at any width.
 */
export function fitViewBox(b: Bounds, pad: number): string {
  return [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2].map(trim).join(' ');
}

const wrap = (x: number, total: number) => ((x % total) + total) % total;

/**
 * Dash that covers the `len` units of the lap behind `head`, wrapping across
 * the start line. The dash starts at path distance head - len, so the pattern
 * offset is len - head, normalised into [0, total).
 */
export function dashAt(head: number, len: number, total = PATH_UNITS): { dasharray: string; dashoffset: number } {
  return { dasharray: `${trim(len)} ${trim(total - len)}`, dashoffset: wrap(len - head, total) };
}

/** Head position (path units) after `elapsedMs` at constant speed, one lap per `lapMs`. */
export function lapHead(elapsedMs: number, lapMs: number, start = 0): number {
  return wrap(start + (elapsedMs / lapMs) * PATH_UNITS, PATH_UNITS);
}

/** Accumulates the trace's own clock; only moves forward, by at most `maxStep` ms per frame. */
export function advanceClock(elapsedMs: number, deltaMs: number, maxStep = MAX_STEP_MS): number {
  if (!(deltaMs > 0)) return elapsedMs;
  return elapsedMs + Math.min(deltaMs, maxStep);
}

export type CometLayer = {
  /** Path units behind the head. */
  length: number;
  /** Multiplier of the head width (the tail tapers). */
  width: number;
  opacity: number;
  /** CSS rgb() colour. */
  color: string;
};

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const RED_LIGHT: Rgb = [255, 79, 71]; // --bc-red-text
const RED: Rgb = [225, 6, 0]; // --bc-red
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * k)) as Rgb;

/** Colour at fraction `t` of the tail (0 = head): white, then light red, then brand red. */
function tailColour(t: number): Rgb {
  if (t <= 0.1) return WHITE;
  if (t <= 0.4) return mix(WHITE, RED_LIGHT, (t - 0.1) / 0.3);
  return mix(RED_LIGHT, RED, (t - 0.4) / 0.6);
}

/**
 * The comet as stacked strokes that all end at the head, painted back to
 * front: each layer is shorter, wider, brighter and whiter than the one under
 * it, so the visible tail tapers and fades from a white head through red to
 * nearly transparent, with no seams between slices.
 */
export function cometLayers(count = 28, tail = TAIL): CometLayer[] {
  const out: CometLayer[] = [];
  for (let i = 0; i < count; i++) {
    const t = 1 - i / count; // 1 (whole tail) .. 1/count (just the head)
    const fade = t <= 0.3 ? 1 : Math.pow(1 - (t - 0.3) / 0.7, 1.5);
    const [r, g, b] = tailColour(t);
    out.push({
      length: trim(tail * PATH_UNITS * t),
      width: trim(0.3 + 0.7 * Math.pow(1 - t + 1 / count, 0.7)),
      opacity: trim(Math.max(0.04, fade)),
      color: `rgb(${r} ${g} ${b})`,
    });
  }
  return out;
}

export type TraceMode = 'lap' | 'static';
/** Reduced motion: no movement, a still full-lap trace instead. */
export function traceMode(reducedMotion: boolean): TraceMode {
  return reducedMotion ? 'static' : 'lap';
}

/**
 * Start/finish marker: the first point of the geometry, and the track
 * direction there in degrees, rounded so the server and browser render the
 * same transform (their Math.atan2 can differ in the last digits).
 */
export function startMarker(pts: readonly Point[]): { x: number; y: number; angle: number } | null {
  const first = pts[0];
  const next = pts.slice(1).find(([x, y]) => first && (x !== first[0] || y !== first[1]));
  if (!first || !next) return null;
  return { x: first[0], y: first[1], angle: trim((Math.atan2(next[1] - first[1], next[0] - first[0]) * 180) / Math.PI) };
}
