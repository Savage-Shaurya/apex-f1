/**
 * Sharpness measurement for responsive images (SmartImage).
 *
 * Under `srcset` with `w` descriptors, `img.naturalWidth` is density-corrected:
 * it equals the `sizes` slot width, not the file's pixels (visual audit
 * 2026-11-01, RES-5 / HNV low). The true width of the delivered file is the
 * `w` descriptor of the candidate the browser picked (`currentSrc`). Every
 * candidate label is the file's real width (lib/image-renditions guarantees it).
 */

export interface SrcSetCandidate {
  url: string;
  w: number;
}

/** `url Nw` candidates of a srcset. URLs end at whitespace and may contain commas. */
export function srcSetCandidates(srcSet: string): SrcSetCandidate[] {
  const out: SrcSetCandidate[] = [];
  const re = /(\S+)\s+(\d+)w\s*(?:,|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(srcSet.trim()))) out.push({ url: m[1]!.replace(/^,+/, ''), w: Number(m[2]) });
  return out;
}

function absolute(url: string, base?: string): string {
  try { return new URL(url, base ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/')).href; } catch { return url; }
}

/**
 * The real pixel width of the file an <img> is showing: the picked srcset
 * candidate's `w`, else `naturalWidth` (no srcset, or a fallback URL outside
 * it, means density 1 and naturalWidth is exact).
 */
export function pixelWidth({ naturalWidth, currentSrc, srcSet, base }: { naturalWidth: number; currentSrc: string; srcSet?: string | null; base?: string }): number {
  if (srcSet && currentSrc) {
    const current = absolute(currentSrc, base);
    const hit = srcSetCandidates(srcSet).find((c) => absolute(c.url, base) === current);
    if (hit) return hit.w;
  }
  return naturalWidth;
}

/** File pixels per device pixel of the frame; dpr is capped at 2 (a dpr-3 phone is judged at 2x). Below ~0.5 reads as soft. */
export function sharpnessRatio(pixels: number, renderedWidth: number, dpr: number): number {
  if (!(renderedWidth > 0)) return 1;
  return pixels / (renderedWidth * Math.min(Math.max(dpr || 1, 1), 2));
}

export const SOFT_RATIO = 0.5;
