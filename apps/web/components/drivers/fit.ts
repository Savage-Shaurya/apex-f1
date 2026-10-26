/**
 * Display sizes that fit their container: Anybody 800 advance widths per
 * glyph (measured; moved here from components/profile/livery.ts). Used with
 * `container-type: inline-size` on the parent so a surname or team name is
 * always set as large as fits, and never clips.
 */
// Advance/em of Anybody at weight 800, normal width (see components/data/name-sizing).
const ADVANCE: Readonly<Record<string, number>> = {
  A: 0.761, B: 0.71, C: 0.7055, D: 0.7025, E: 0.593, F: 0.552, G: 0.729,
  H: 0.7215, I: 0.3315, J: 0.7, K: 0.6735, L: 0.5385, M: 0.9625, N: 0.831,
  O: 0.7295, P: 0.676, Q: 0.7305, R: 0.6965, S: 0.7105, T: 0.668, U: 0.7315,
  V: 0.724, W: 1.068, X: 0.7255, Y: 0.7415, Z: 0.61,
  '0': 0.64, '1': 0.6035, '2': 0.6545, '3': 0.6545, '4': 0.6475,
  '5': 0.6455, '6': 0.652, '7': 0.5855, '8': 0.6435, '9': 0.653,
  '-': 0.4785, "'": 0.1955, '&': 0.847, '.': 0.2615, ' ': 0.28,
};

function measure(word: string): number {
  return Array.from(word).reduce((w, ch) => w + (ADVANCE[ch] ?? 1.1), 0);
}
function normalise(text: string) {
  return text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Font size that fits `text` inside the nearest inline-size container.
 * `stretch` is the width-axis multiplier (1.2 ≈ font-stretch 125%).
 * `oneLine` fits the whole string; otherwise the longest word (a hyphen is a
 * break point: render `<wbr>` after it, see hyphenParts).
 */
export function fitSize(text: string, preferred: string, { stretch = 1, oneLine = false }: { stretch?: number; oneLine?: boolean } = {}): string {
  const t = normalise(text);
  const width = oneLine ? measure(t) : Math.max(1, ...t.split(/\s+|(?<=-)/u).map(measure));
  const advance = (Math.max(1, width) * stretch * 1.05).toFixed(4);
  return `min(${preferred}, calc(100cqi / ${advance}))`;
}


/** Split a name so the browser may break after each hyphen ("Montgomerie-|Charrington"). */
export function hyphenParts(text: string): string[] {
  return text.split(/(?<=-)/u);
}
