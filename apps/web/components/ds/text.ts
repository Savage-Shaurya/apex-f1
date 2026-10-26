/**
 * Shorten a teaser at a word boundary with an ellipsis, instead of clipping
 * glyphs with CSS line-clamp. Full text stays one click away.
 */
export function trimSummary(text: string | null | undefined, max = 200): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : clean.slice(0, max)).replace(/[\s,;:.\-–—]+$/, '');
  return `${base}…`;
}
