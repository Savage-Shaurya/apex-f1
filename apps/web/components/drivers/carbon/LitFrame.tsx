'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@apex/ui';

/**
 * The lit wrapper of LitPortrait. The key, top and rim lights are masked by
 * the photo itself (`.bc-lit { mask-image: var(--src) }`). A CSS mask ignores
 * `loading="lazy"`, so setting the mask URL at render made every card on the
 * page download its cut-out at page open, competing with the LCP leader
 * (audit 2026-11-01 DRV-4: 22 requests on /drivers before any scroll). The
 * mask URL is set only once the portrait's own <img> has loaded, and it is
 * that img's `currentSrc`, so the light reuses the same file (one download,
 * not two). The lights were invisible until then anyway (drivers.css), so
 * the finished look is unchanged.
 */
export function LitFrame({ masked, team, frameRatio, full, className, style, children }: {
  masked: boolean;
  team: string;
  frameRatio: string;
  full: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mask, setMask] = useState<string | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!masked || !root) return;
    // The cut-out is SmartImage's img (inside [data-image-state]), never the decorative number glyph,
    // and never a photograph fallback (its rectangle would light the whole frame).
    const pick = () => {
      const img = root.querySelector<HTMLImageElement>(".ds-portrait[data-variant='cutout'] [data-image-state] > img");
      if (img && img.complete && img.naturalWidth > 0 && img.currentSrc) setMask(img.currentSrc);
    };
    pick();
    // `load` does not bubble: listen in the capture phase for the portrait's img (and any fallback swap).
    root.addEventListener('load', pick, true);
    return () => root.removeEventListener('load', pick, true);
  }, [masked]);

  const vars = { '--team': team, '--src': mask ? `url("${mask}")` : 'none' } as CSSProperties;
  return (
    <div ref={ref} className={cn('dr-lit relative', className)} style={{ ...vars, ...style }}>
      {children}
      {masked && mask && (
        <div aria-hidden className="dr-light" style={{ aspectRatio: frameRatio, bottom: 'auto', ...(full ? { padding: '4% 4% 0' } : null) }}>
          <div className="relative h-full w-full">
            <div className="bc-lit bc-lit--key" />
            <div className="bc-lit bc-lit--top" />
            <div className="bc-lit bc-lit--rim" />
          </div>
        </div>
      )}
    </div>
  );
}
