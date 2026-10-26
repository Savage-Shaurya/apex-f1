import { getCircuit } from '@/lib/circuits';

/**
 * A small circuit outline for a search row, built on the server from the real
 * track geometry (lib/circuits) and thinned to at most `maxPoints` vertices
 * so two dozen of them stay a few kilobytes in the client payload. Returns
 * null for an unknown circuit (the row then shows no glyph, never a stand-in).
 */
export function miniCircuit(circuitId: string | null | undefined, maxPoints = 90): { d: string; viewBox: string } | null {
  const c = getCircuit(circuitId);
  if (!c || c.points.length < 6) return null;
  const total = c.points.length / 2;
  const step = Math.max(1, Math.ceil(total / maxPoints));
  const coords: string[] = [];
  for (let i = 0; i < total; i += step) coords.push(`${Math.round(c.points[i * 2]!)} ${Math.round(c.points[i * 2 + 1]!)}`);
  const pad = 40;
  return { d: `M${coords.join('L')}Z`, viewBox: `${-pad} ${-pad} ${Math.round(c.width) + pad * 2} ${Math.round(c.height) + pad * 2}` };
}
