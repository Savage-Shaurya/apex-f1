'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';
import { MEDIA_RULES, resolveFit } from '@/components/ds';
import { parseRatio } from '@/components/ds/media-rules';

/** Same watchdog as the ds Media frame: a hung request never leaves an empty frame. */
const LOAD_TIMEOUT_MS = 8000;

/**
 * A publisher's own story picture (news policy section 5).
 *
 * Unlike the ds `Media` frame, a failed news picture is never replaced by an
 * "Image unavailable" box: the frame removes itself and the card closes up
 * into its text-only layout (cards style that with `:has([data-wire-image])`).
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
}) {
  const rule = MEDIA_RULES[kind];
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const el = frame.current;
    if (failed || loaded || !el) return;
    let timer: number | undefined;
    const arm = () => { if (timer === undefined) timer = window.setTimeout(fail, LOAD_TIMEOUT_MS); };
    if (typeof IntersectionObserver === 'undefined') { arm(); return () => window.clearTimeout(timer); }
    const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { arm(); io.disconnect(); } });
    io.observe(el);
    return () => { io.disconnect(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [failed, loaded, fail]);

  if (failed) return null;
  const fit = resolveFit(rule, natural, parseRatio(rule.ratio));

  return (
    <figure data-wire-image className={cn('min-w-0', className)}>
      <div
        ref={frame}
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
