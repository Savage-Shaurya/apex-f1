'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@apex/ui';
import { bestRendition } from '@/lib/image-renditions';

/** The F1 media car masters are 4.5:1 side views (the CDN asset's own ratio). */
export const CAR_RATIO = 1200 / 264;

/** The same F1 media car at another CDN width (c_fit,w_N), so the photo, its mirror and its light mask share one download. */
export function carAt(url: string, width: number): string {
  return /c_fit,w_\d+/.test(url) ? url.replace(/c_fit,w_\d+/, `c_fit,w_${width}`) : url;
}

/**
 * A real 2026 (or earlier) car, shown whole and lit instead of pasted on a
 * flat box: the team colour as a light field behind it, a cool floodlight
 * pool on a gloss floor, a key light from above and a team rim from behind
 * (both masked to the car's own silhouette, so light lands only on the car),
 * a contact shadow under the tyres and a soft reflection in the floor.
 *
 * The car box has the master's exact ratio and the floor below it is part of
 * the reserved height, so nothing moves when the picture arrives. A picture
 * that fails keeps its box and says so; it never shows a broken icon.
 * Promote to ds once a second area needs it.
 */
export function CarStage({
  src,
  alt,
  color,
  priority = false,
  sizes = '(max-width: 768px) 92vw, 60vw',
  reflection = true,
  field = true,
  glare = false,
  className,
  style,
}: {
  src: string | null;
  alt: string;
  color: string | null;
  priority?: boolean;
  sizes?: string;
  reflection?: boolean;
  /** Team light field behind the car (off where several cars share one light). */
  field?: boolean;
  /** One glare streak across the car on hover or focus of the enclosing `.group`. */
  glare?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const img = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const rendition = useMemo(() => (src ? bestRendition(src) : null), [src]);
  const mask = src ? carAt(src, 960) : null;

  // An image that failed before hydration never fires onError in React: check it once.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) setFailed(true);
  }, [src]);

  const team = color ?? '#6b6e76';
  const vars = { '--team': team, '--src': mask ? `url("${mask}")` : 'none', ...style } as CSSProperties;
  const show = Boolean(src) && !failed;
  return (
    <figure className={cn('tc-stage m-0', className)} style={vars}>
      {field && <div aria-hidden className="tc-stage__field" />}
      <div aria-hidden className="tc-stage__pool" />
      {/* car box + 22% floor below it, reserved before anything loads */}
      <div className="relative" style={{ paddingBottom: '5.5%' }}>
        <div className="relative w-full" style={{ aspectRatio: '1200 / 264' }}>
          <div aria-hidden className="tc-stage__shadow" style={{ bottom: '-3.5%' }} />
          <div aria-hidden className="tc-stage__floor" style={{ bottom: '1.5%' }} />
          {show ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- F1 media CDN renditions by width; the box reserves the space */}
              <img
                ref={img}
                src={rendition?.src ?? src!}
                srcSet={rendition?.srcSet}
                sizes={sizes}
                alt={alt}
                decoding="async"
                loading={priority ? 'eager' : 'lazy'}
                fetchPriority={priority ? 'high' : 'auto'}
                onError={() => setFailed(true)}
                className="tc-car absolute inset-0 h-full w-full object-contain"
              />
              <div aria-hidden className="tc-lit tc-lit--key" />
              <div aria-hidden className="tc-lit tc-lit--rim" />
              {reflection && (
                // eslint-disable-next-line @next/next/no-img-element -- decorative mirror of the same rendition
                <img src={mask!} alt="" aria-hidden decoding="async" loading="lazy" className="tc-reflect pointer-events-none absolute left-0 top-[97%] h-full w-full object-contain" />
              )}
              {glare && <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><div className="bc-glare" /></div>}
            </>
          ) : (
            <figcaption className="bc-label absolute inset-0 grid place-items-center text-[color:var(--bc-titanium)]">
              {src ? 'Photo unavailable' : 'Car photo unavailable'}
              <span className="sr-only">: {alt}</span>
            </figcaption>
          )}
        </div>
      </div>
    </figure>
  );
}

/**
 * A team logo (white on transparent from F1 media), contained in a fixed box
 * with a soft halo of the team light. A failed logo simply leaves the box
 * empty and hidden from assistive tech: the team name is always text beside it.
 */
export function TeamLogo({ src, name, color, className }: { src: string | null; name: string; color: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) setFailed(true);
  }, [src]);
  if (!src) return null;
  return (
    <span aria-hidden={failed || undefined} className={cn('relative block shrink-0', className)} style={{ '--team': color ?? '#6b6e76' } as CSSProperties}>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element -- small CDN logo; the box reserves the space
        <img ref={ref} src={src} alt={`${name} logo`} decoding="async" loading="lazy" onError={() => setFailed(true)} className="tc-logo absolute inset-0 h-full w-full object-contain" />
      )}
    </span>
  );
}
