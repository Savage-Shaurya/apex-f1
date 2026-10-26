'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';
import { cloudinaryAspect, f1FramedCutout, isPhotograph } from '@/lib/f1-media-urls';
import { normalizeHex } from './color';
import { parseRatio, FIT_TOLERANCE } from './media-rules';
import type { MediaCredit } from './Media';
import { initialsOf } from './initials';

export { initialsOf };

/**
 * How a cut-out fills its frame:
 *  - `bust`: waist-up, head anchored to the top (cards, plaques, plinths)
 *  - `head`: head and shoulders (index rows, tables)
 *  - `full`: the whole body standing on the floor (profile hero, duels)
 */
export type PortraitFraming = 'bust' | 'head' | 'full';

const RATIO_BY_FRAMING: Record<PortraitFraming, string> = { bust: '4 / 5', head: '1 / 1', full: '5 / 8' };
export const PORTRAIT_TIMEOUT_MS = 8000;

export interface PortraitProps {
  src?: string | null;
  /** Tried when `src` fails or times out (often a credited Commons photo). */
  fallbackSrc?: string | null;
  fallbackCredit?: MediaCredit | null;
  /** Person (or team) shown; also the source of the initials when there is no picture. */
  name: string;
  /** Accessible description; defaults to `name`. Empty string marks it decorative. */
  alt?: string;
  /** `cutout` for transparent F1 media cut-outs, `photo` for photographs. Detected from the URL when omitted. */
  variant?: 'cutout' | 'photo';
  framing?: PortraitFraming;
  /** CSS aspect ratio of the frame; defaults per framing. */
  ratio?: string;
  /** Team colour (data) for the field; neutral carbon when absent. */
  teamColor?: string | null;
  /** object-position for photographs; faces sit in the upper third by default. */
  focal?: string;
  priority?: boolean;
  sizes?: string;
  credit?: MediaCredit | null;
  /** Hover sheen (CSS only). */
  glare?: boolean;
  /** Decorative race-number glyph behind a cut-out (the number is always text elsewhere). */
  glyph?: string | null;
  /** Padding around a full-body cut-out (CSS shorthand); the bottom stays 0 so feet meet the floor. */
  inset?: string;
  /** Custom content for the no-picture state; defaults to initials and an honest label. */
  empty?: ReactNode;
  /** Label under the initials in the no-picture state. Null hides it. */
  emptyLabel?: string | null;
  timeoutMs?: number;
  className?: string;
  frameClassName?: string;
  style?: CSSProperties;
}

/**
 * Portrait: the design system's one picture treatment for people. A cut-out
 * stands in a lit team-colour field with a floor shadow (see portrait.css),
 * cropped by the CDN to a consistent baseline for its framing; a photograph
 * keeps its own ground and is never cropped past FIT_TOLERANCE. No picture,
 * or a picture that fails, shows the person's initials on the same field
 * with a truthful label, never a broken icon or an empty box. The frame's
 * aspect ratio is fixed before anything loads, so nothing shifts.
 */
export function Portrait({
  src,
  fallbackSrc,
  fallbackCredit,
  name,
  alt,
  variant,
  framing = 'bust',
  ratio,
  teamColor,
  focal = '50% 22%',
  priority = false,
  sizes = '(max-width: 640px) 45vw, 20vw',
  credit,
  glare = false,
  glyph,
  inset,
  empty,
  emptyLabel = 'Photo unavailable',
  timeoutMs = PORTRAIT_TIMEOUT_MS,
  className,
  frameClassName,
  style,
}: PortraitProps) {
  const frameRatio = ratio ?? RATIO_BY_FRAMING[framing];
  const sources = [src, fallbackSrc].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [glyphOk, setGlyphOk] = useState(true);
  const frameRef = useRef<HTMLDivElement>(null);
  const raw = sources[attempt] ?? null;
  const kind: 'cutout' | 'photo' = raw && (attempt === 0 && variant ? variant === 'photo' : isPhotograph(raw)) ? 'photo' : 'cutout';
  const aspect = cloudinaryAspect(frameRatio);
  const current = raw && kind === 'cutout' && framing !== 'full' && aspect ? f1FramedCutout(raw, aspect, 640) : raw;
  const usingFallback = Boolean(fallbackSrc) && raw === fallbackSrc && raw !== src;
  const shownCredit = !raw ? null : usingFallback ? (fallbackCredit ?? null) : (credit ?? null);
  const label = alt ?? name;

  const fail = useCallback(() => { setLoaded(false); setNatural(null); setAttempt((a) => a + 1); }, [setLoaded, setNatural, setAttempt]);
  const measured = useCallback((m: { naturalWidth: number; naturalHeight: number }) => {
    setLoaded(true);
    setNatural((prev) => (prev && prev.w === m.naturalWidth && prev.h === m.naturalHeight ? prev : { w: m.naturalWidth, h: m.naturalHeight }));
  }, [setLoaded, setNatural]);

  // Load watchdog, armed once the frame is on screen: a hung request never leaves an empty frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!current || loaded || !el) return;
    let timer: number | undefined;
    const arm = () => { if (timer === undefined) timer = window.setTimeout(fail, timeoutMs); };
    if (typeof IntersectionObserver === 'undefined') { arm(); return () => window.clearTimeout(timer); }
    const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { arm(); io.disconnect(); } });
    io.observe(el);
    return () => { io.disconnect(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [current, loaded, timeoutMs, fail]);

  // Photographs cover only when the crop stays within FIT_TOLERANCE; otherwise they are matted whole.
  let photoFit: 'cover' | 'contain' = 'cover';
  if (kind === 'photo' && natural && natural.w && natural.h) {
    const a = natural.w / natural.h;
    const b = parseRatio(frameRatio);
    photoFit = Math.abs(a - b) / Math.max(a, b) <= FIT_TOLERANCE ? 'cover' : 'contain';
  }
  const team = normalizeHex(teamColor);
  const fullInset = inset ?? '5% 6% 0';

  return (
    <figure className={cn('min-w-0', className)} style={style}>
      <div
        ref={frameRef}
        className={cn('ds-portrait', frameClassName)}
        data-variant={current ? kind : 'empty'}
        data-framing={kind === 'cutout' ? framing : undefined}
        data-media-state={current ? (loaded ? 'loaded' : 'loading') : 'empty'}
        style={{ aspectRatio: frameRatio, ...(team ? ({ '--portrait-team': team } as CSSProperties) : null) }}
      >
        {glyph && glyphOk && current && kind === 'cutout' && (
          // eslint-disable-next-line @next/next/no-img-element -- decorative CDN glyph, hidden on error
          <img
            src={glyph}
            alt=""
            aria-hidden
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setGlyphOk(false)}
            className="pointer-events-none absolute right-[6%] top-[6%] z-0 h-[30%] w-auto select-none object-contain opacity-[0.14]"
          />
        )}
        {current ? (
          <SmartImage
            key={current}
            src={current}
            alt={label}
            eager={priority}
            sizes={sizes}
            fit={kind === 'photo' ? photoFit : 'contain'}
            focal={kind === 'photo' ? (photoFit === 'cover' ? focal : '50% 50%') : framing === 'full' ? '50% 100%' : '50% 0%'}
            accent="transparent"
            allowUpscale={kind === 'cutout'}
            className="absolute inset-0 z-[1]"
            style={kind === 'cutout' && framing === 'full' ? { padding: fullInset, paddingBottom: 0 } : undefined}
            onMeasure={measured}
            onFail={fail}
          />
        ) : (
          empty ?? (
            <div role={label ? 'img' : undefined} aria-label={label ? `${label} (${(emptyLabel ?? 'photo unavailable').toLowerCase()})` : undefined} aria-hidden={label ? undefined : true} className="absolute inset-0">
              <span aria-hidden className="ds-portrait__monogram">{initialsOf(name)}</span>
              {emptyLabel && <span aria-hidden className="ds-portrait__label font-text">{emptyLabel}</span>}
            </div>
          )
        )}
        {glare && current && <span aria-hidden className="ds-portrait__glare" />}
      </div>
      {shownCredit && (
        <figcaption className="mt-2 font-text text-caption text-fg-3">
          {shownCredit.href ? (
            <a href={shownCredit.href} target="_blank" rel="noopener noreferrer" className="relative z-[1] inline-flex min-h-6 items-center underline decoration-[var(--rule-strong)] underline-offset-2 hover:text-fg">
              {shownCredit.label}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            shownCredit.label
          )}
        </figcaption>
      )}
    </figure>
  );
}
