import { CIRCUITS, type CircuitGeometry } from './data';

export type { CircuitGeometry };

/** Jolpica ids that changed or have common aliases. */
const ALIASES: Record<string, string> = {
  paul_ricard: 'ricard',
  hockenheim: 'hockenheimring',
  madrid: 'madring',
  las_vegas: 'vegas',
  cota: 'americas',
};

/** Real circuit outline (bacinger/f1-circuits, MIT) for a Jolpica circuitId. */
export function getCircuit(circuitId?: string | null): CircuitGeometry | null {
  if (!circuitId) return null;
  return CIRCUITS[circuitId] ?? CIRCUITS[ALIASES[circuitId] ?? ''] ?? null;
}

/** Closed SVG path in the circuit's own width x height box. */
export function circuitPath(c: CircuitGeometry): string {
  const p = c.points;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
  return `${d}Z`;
}

/** Points as [x, y] pairs centred on the origin and scaled to fit `size`. */
export function circuitPoints(c: CircuitGeometry, size = 10): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const s = size / 1000;
  for (let i = 0; i < c.points.length; i += 2) {
    out.push([(c.points[i]! - c.width / 2) * s, (c.points[i + 1]! - c.height / 2) * s]);
  }
  return out;
}
