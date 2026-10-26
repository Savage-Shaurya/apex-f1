/**
 * Colour maths for data colours (team liveries, OpenF1 `team_colour`).
 * Team colour is data: a stripe, a dot, a chart line or a field behind a
 * cut-out. When it has to carry text, these helpers pick or adjust the ink
 * so the pair still meets WCAG AA.
 */

const CARBON = '#0b0b0c';
const WHITE = '#ffffff';

/** Accepts "3671C6", "#3671c6" or "#36c"; returns "#3671c6" or null. */
export function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
  return null;
}

function channels(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? CARBON;
  return [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16)) as [number, number, number];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white ink for text placed on a colour field (whichever contrasts more). */
export function readableInkOn(background: string): '#0b0b0c' | '#ffffff' {
  return contrastRatio(CARBON, background) >= contrastRatio(WHITE, background) ? CARBON : WHITE;
}

function mix(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((v, i) => Math.round(v + (cb[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The team colour as readable text on a ground: unchanged when it already
 * passes, otherwise mixed toward white (dark ground) or black (light ground)
 * in small steps until it reaches `min` (4.5 by default).
 */
export function readableTeamText(team: string, ground: string = CARBON, min = 4.5): string {
  const base = normalizeHex(team);
  if (!base) return relativeLuminance(ground) < 0.5 ? '#f4f4f5' : CARBON;
  if (contrastRatio(base, ground) >= min) return base;
  const toward = relativeLuminance(ground) < 0.5 ? WHITE : CARBON;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidate = mix(base, toward, t);
    if (contrastRatio(candidate, ground) >= min) return candidate;
  }
  return toward;
}

/** A quiet field behind a headshot or cut-out: the team colour mixed into a carbon surface. */
export function teamField(team: string | null | undefined, amount = 0.28, surface = '#17171a'): string {
  const base = normalizeHex(team);
  return base ? mix(surface, base, amount) : surface;
}

/** Non-text marks (stripes, dots) need 3:1 against their ground to be perceivable. */
export function isPerceivableMark(color: string, ground: string = CARBON): boolean {
  return contrastRatio(color, ground) >= 3;
}
