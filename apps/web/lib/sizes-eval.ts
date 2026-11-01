/**
 * A small evaluator for the `sizes` attribute (only what Apex uses: px and vw
 * lengths, `(max-width|min-width: Npx)` conditions joined by `and`). Used by
 * tests that keep `sizes` at least as wide as the measured layout.
 */
export function evaluateSizes(sizes: string, viewportWidth: number): number {
  const length = (v: string): number => {
    const t = v.trim();
    const px = t.match(/^([\d.]+)px$/);
    if (px) return Number(px[1]);
    const vw = t.match(/^([\d.]+)vw$/);
    if (vw) return (Number(vw[1]) / 100) * viewportWidth;
    const calc = t.match(/^min\((.+),(.+)\)$/);
    if (calc) return Math.min(length(calc[1]!), length(calc[2]!));
    throw new Error(`unsupported sizes length: ${t}`);
  };
  const entries = sizes.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const m = entry.match(/^((?:\([^)]*\)\s*(?:and\s*)?)+)\s*(.+)$/);
    if (!m) return length(entry);
    const ok = [...m[1]!.matchAll(/\((max|min)-width:\s*([\d.]+)px\)/g)].every(([, kind, n]) => (kind === 'max' ? viewportWidth <= Number(n) : viewportWidth >= Number(n)));
    if (ok) return length(m[2]!);
  }
  return viewportWidth;
}
