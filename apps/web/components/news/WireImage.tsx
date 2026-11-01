'use client';

import { useCallback, useState } from 'react';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';
import { MEDIA_RULES, resolveFit } from '@/components/ds';
import { parseRatio } from '@/components/ds/media-rules';

/**
 * A publisher's own story picture (news policy section 5).
 *
 * Unlike the ds `Media` frame, a failed news picture is never replaced by an
 * "Image unavailable" box: the frame removes itself and the card closes up
 * into its text-only layout (cards style that with `:has([data-wire-image])`).
 * Only a real error removes it: a slow photo keeps its reserved, tinted frame
 * and appears when it arrives (audit 2026-11-01 HNV-5; an 8 s watchdog used
 * to delete slow photos for good on slow 4G). Photos come through the Next
 * image optimizer at the card's width (WebP), with the publisher's own
 * rendition as the fallback (HNV-4); Commons and YouTube pictures use their
 * hosts' own renditions instead (review 2026-11-01).
 * Framing follows the ds no-crop rule: cover only when the source is within
 * 20% of the frame's ratio, otherwise the whole picture is contained.
 */
export function WireImage({
  src,
  alt,
  kind = 'photo',
  sizes,
  priority = false,
  zoom = true,
  credit,
  radius = 'm',
  className,
  onFail,
}: {
  src: string;
  alt: string;
  kind?: 'photo' | 'wide' | 'square';
  sizes: string;
  priority?: boolean;
  /** 1.025 scale on card hover (ds motion recipe). */
  zoom?: boolean;
  /** Credit line under the picture, e.g. "Image: Autosport". Removed with the picture if it fails. */
  credit?: string;
  /** Corner radius: 'l' for the lead story's screen, 'm' for cards. */
  radius?: 'm' | 'l';
  className?: string;
  /** Told when the picture failed and removed itself, so a caller can show its own fallback. */
  onFail?: () => void;
}) {
  const rule = MEDIA_RULES[kind];
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const fail = useCallback(() => {
    setFailed(true);
    onFail?.();
  }, [onFail]);

  if (failed) return null;
  const fit = resolveFit(rule, natural, parseRatio(rule.ratio));

  return (
    <figure data-wire-image className={cn('min-w-0', className)}>
      <div
        data-media-state={loaded ? 'loaded' : 'loading'}
        className={cn('relative isolate overflow-hidden bg-[color:var(--bc-carbon-2,#111114)] ring-1 ring-white/10', radius === 'l' ? 'rounded-[22px]' : 'rounded-[14px]')}
        style={{ aspectRatio: rule.ratio }}
      >
        <div className={cn('absolute inset-0', zoom && 'transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover/story:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover/story:scale-100')}>
          <SmartImage
            src={src}
            alt={alt}
            eager={priority}
            sizes={sizes}
            optimize
            fit={fit}
            className="absolute inset-0"
            onMeasure={(m) => {
              setLoaded(true);
              setNatural((prev) => (prev && prev.width === m.naturalWidth && prev.height === m.naturalHeight ? prev : { width: m.naturalWidth, height: m.naturalHeight }));
            }}
            onFail={fail}
          />
        </div>
        {/* GlareHover streak (React Bits, CSS edition from brand-c): a light sweep across the print on hover or focus. */}
        <span aria-hidden className="bc-glare z-[1]" />
      </div>
      {credit && <figcaption className="mt-2 text-[0.75rem] text-[color:var(--bc-titanium,#9b9ea7)]">{credit}</figcaption>}
    </figure>
  );
}
