import { getCircuitInfoboxes, type CircuitLayout } from '@apex/api-client/wikipedia';

/* ---------------------------------------------------------------------------
 * Lap length by year: the Grand Prix layouts a circuit has used, each with
 * the years it was in use and its published length. Read from the same
 * circuit infobox as the season facts (lib/circuits/facts, cached 30 days).
 * Layouts for other series (motorcycle, Formula E, national, oval...) are
 * left out; when the infobox names Grand Prix layouts, only those are kept.
 * ------------------------------------------------------------------------- */

export interface LayoutEra {
  name: string;
  from: number;
  /** null: still in use. */
  to: number | null;
  lengthKm: number;
}

const GRAND_PRIX = /grand\s*prix|\bgp\b|formula\s*(?:one|1)\b|\bf1\b/i;

export function layoutEras(layouts: readonly CircuitLayout[]): LayoutEra[] {
  const usable = layouts.filter((l) => l.lengthKm != null && l.segments.some((s) => !s.excluded));
  const gp = usable.filter((l) => l.segments.some((s) => !s.excluded && GRAND_PRIX.test(s.name)));
  const pool = gp.length ? gp : usable;
  const eras: LayoutEra[] = [];
  for (const l of pool) {
    for (const seg of l.segments) {
      if (seg.excluded || (gp.length && !GRAND_PRIX.test(seg.name))) continue;
      for (const r of seg.ranges) eras.push({ name: seg.name, from: r.from, to: r.to, lengthKm: l.lengthKm! });
    }
  }
  // Newest first; drop exact duplicates.
  const seen = new Set<string>();
  return eras
    .sort((a, b) => (b.to ?? 9999) - (a.to ?? 9999) || b.from - a.from)
    .filter((e) => { const k = `${e.from}-${e.to}-${e.lengthKm}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The circuit's layout eras, or null when the infobox cannot be read (callers then show only this season's figure). */
export async function loadLayoutEras(circuitWikiUrl: string | undefined): Promise<LayoutEra[] | null> {
  if (!circuitWikiUrl) return null;
  try {
    const map = await getCircuitInfoboxes([circuitWikiUrl], { strict: true });
    const eras = layoutEras(map.get(circuitWikiUrl) ?? []);
    return eras.length ? eras : null;
  } catch {
    return null;
  }
}
