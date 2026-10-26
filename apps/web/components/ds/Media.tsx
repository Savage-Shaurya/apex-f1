'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';
import { MEDIA_RULES, parseRatio, resolveFit, type MediaKind } from './media-rules';
import { normalizeHex } from './color';
import { Portrait } from './Portrait';

export interface MediaCredit {
  /** e.g. "Formula 1 media", "Wikimedia Commons / Jane Doe, CC BY-SA 4.0" */
  label: string;
  href?: string;
}

/**
 * A picture slot that never crops its subject (see media-rules.ts). Uses the
 * hardened SmartImage for renditions, fallbacks and the resolution guard.
 * Captions and credits sit below the picture, never on its pixels.
 *
 * Never an empty frame: if the picture (and its fallback) fails, or has not
 * loaded LOAD_TIMEOUT_MS after the frame came into view, the frame switches
 * to the labelled "Image unavailable" state. `fallbackSrc` is tried after
 * `src` fails, and its own credit replaces the primary one.
 */
export const LOAD_TIMEOUT_MS = 8000;

/**
 * The load watchdog: once the frame is on screen (or at once without
 * IntersectionObserver) a timer starts; if the image has not loaded when it
 * fires, `fail` switches the frame to "Image unavailable". Returns cleanup.
 */
export function armLoadWatchdog(
  frame: unknown,
  fail: () => void,
  timeoutMs: number,
  env: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void; observe: ((target: unknown, onVisible: () => void) => () => void) | null },
): () => void {
  let timer: number | undefined;
  let stopObserving: (() => void) | null = null;
  const arm = () => { if (timer === undefined) timer = env.setTimeout(fail, timeoutMs); stopObserving?.(); };
  if (!env.observe) arm();
  else stopObserving = env.observe(frame, arm);
  return () => { stopObserving?.(); if (timer !== undefined) env.clearTimeout(timer); };
}

type MediaProps = Parameters<typeof MediaFrame>[0];
export function Media(props: MediaProps) {
  // People always get the shared portrait treatment (components/ds/Portrait).
  if (props.kind === 'headshot') {
    const { src, fallbackSrc, fallbackCredit, timeoutMs, alt, ratio, focal, priority, sizes, credit, accent, chamfer, className, frameClassName, style } = props;
    return (
      <Portrait
        src={src}
        fallbackSrc={fallbackSrc}
        fallbackCredit={fallbackCredit}
        timeoutMs={timeoutMs}
        name={alt}
        framing="head"
        ratio={ratio}
        focal={focal}
        priority={priority}
        sizes={sizes}
        credit={credit}
        teamColor={accent}
        className={className}
        frameClassName={cn(chamfer && 'ds-chamfer', frameClassName)}
        style={style}
      />
    );
  }
  return <MediaFrame {...props} />;
}

function MediaFrame({
  src,
  fallbackSrc,
  fallbackCredit,
  timeoutMs = LOAD_TIMEOUT_MS,
  alt,
  kind = 'photo',
  ratio,
  focal,
  priority = false,
  sizes,
  caption,
  credit,
  accent,
  chamfer = false,
  className,
  frameClassName,
  style,
}: {
  src?: string | null;
  /** Tried when `src` fails or times out (e.g. a credited Wikimedia portrait). */
  fallbackSrc?: string | null;
  /** Credit shown when the fallback is the picture on screen. */
  fallbackCredit?: MediaCredit | null;
  /** Override the load timeout (ms) that switches to the unavailable state. */
  timeoutMs?: number;
  /** Describe the picture; empty string only when it is purely decorative. */
  alt: string;
  kind?: MediaKind;
  /** Override the kind's aspect ratio, e.g. "16 / 10". */
  ratio?: string;
  /** object-position for cover crops, e.g. "50% 30%". */
  focal?: string;
  /** The page's real first-view image only. */
  priority?: boolean;
  sizes?: string;
  caption?: ReactNode;
  credit?: MediaCredit | null;
  /** Fallback/backdrop tint (team colour for cut-outs). */
  accent?: string | null;
  /** The single machined corner allowed per view. */
  chamfer?: boolean;
  className?: string;
  frameClassName?: string;
  style?: CSSProperties;
}) {
  const rule = MEDIA_RULES[kind];
  const frameRatio = ratio ?? rule.ratio;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const sources = [src, fallbackSrc].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = sources[attempt] ?? null;
  const missing = !current;
  const usingFallback = Boolean(fallbackSrc) && current === fallbackSrc && current !== src;
  const shownCredit = usingFallback ? (fallbackCredit ?? credit) : credit;
  const frameRef = useRef<HTMLDivElement>(null);
  const fail = useCallback(() => { setLoaded(false); setNatural(null); setAttempt((a) => a + 1); }, []);
  // Stable identity: SmartImage re-measures whenever this callback changes, so an
  // inline function would re-run its settle effect on every render (update loop).
  const measured = useCallback((m: { naturalWidth: number; naturalHeight: number }) => {
    setLoaded((was) => was || true);
    setNatural((prev) => (prev && prev.width === m.naturalWidth && prev.height === m.naturalHeight ? prev : { width: m.naturalWidth, height: m.naturalHeight }));
  }, []);

  // Load watchdog: starts when the frame is on screen (lazy images do not
  // load before that), so a hung request never leaves an empty frame.
  useEffect(() => {
    const el = frameRef.current;
    if (!current || loaded || !el) return;
    return armLoadWatchdog(el, fail, timeoutMs, {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      observe: typeof IntersectionObserver === 'undefined' ? null : (target, onVisible) => {
        const io = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) onVisible(); }, { rootMargin: '0px' });
        io.observe(target as Element);
        return () => io.disconnect();
      },
    });
  }, [current, loaded, timeoutMs, fail]);
  const fit = resolveFit(rule, natural, parseRatio(frameRatio));
  const contained = fit === 'contain';
  // Cars stand on the ground they are placed on, with a contact shadow (portrait.css), never in a box.
  const staged = kind === 'car';
  // A caller that asks for a transparent frame (a white logo on a team-colour band) gets no box behind the mark.
  const clear = /\bbg-transparent\b/.test(frameClassName ?? '');
  const team = normalizeHex(accent);

  return (
    <figure className={cn('min-w-0', className)} style={style}>
      <div
        ref={frameRef}
        data-media-state={missing ? 'unavailable' : loaded ? 'loaded' : 'loading'}
        data-variant={staged && !missing ? 'car' : missing ? 'empty' : undefined}
        className={cn(staged || missing ? 'ds-portrait' : clear ? 'relative overflow-hidden' : 'ds-media-outline relative overflow-hidden bg-tone-raised', chamfer && 'ds-chamfer', frameClassName)}
        style={{ aspectRatio: frameRatio, ...(team ? ({ '--portrait-team': team } as CSSProperties) : null) }}
      >
        {missing ? (
          <div role={alt ? 'img' : undefined} aria-label={alt ? `${alt} (image unavailable)` : undefined} className="absolute inset-0">
            <span aria-hidden className="ds-portrait__label font-text">{kind === 'car' ? 'Car image unavailable' : 'Image unavailable'}</span>
          </div>
        ) : (
        <SmartImage
          key={current}
          src={current}
          alt={alt}
          eager={priority}
          sizes={sizes}
          fit={contained ? 'contain' : 'cover'}
          focal={focal}
          accent={staged || clear ? 'transparent' : null}
          className="absolute inset-0 z-[1]"
          style={rule.inset ? { padding: `${rule.inset}%` } : undefined}
          onMeasure={measured}
          onFail={fail}
        />
        )}
      </div>
      {(caption || shownCredit) && (
        <figcaption className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {caption && <span className="font-text text-small text-fg-2">{caption}</span>}
          {shownCredit && (
            <span className="font-text text-caption text-fg-3">
              {shownCredit.href ? (
                <a href={shownCredit.href} target="_blank" rel="noopener noreferrer" className="relative z-[1] inline-flex min-h-6 items-center underline decoration-[var(--rule-strong)] underline-offset-2 hover:text-fg">
                  {shownCredit.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                shownCredit.label
              )}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Driver headshot: the F1 media CDN cut-out (OpenF1 `headshot_url`) first,
 * always contained on a quiet field of the team's colour, never cropped.
 * A Wikimedia portrait may be passed as `fallbackSrc`; it is used only when
 * the CDN picture is missing, fails or times out, and is then credited.
 */
export function Headshot({
  src,
  fallbackSrc,
  fallbackCredit = { label: 'Portrait: Wikimedia Commons', href: 'https://commons.wikimedia.org/' },
  name,
  teamColor,
  size,
  className,
  priority,
  showCredit = false,
  sizes,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  fallbackCredit?: MediaCredit | null;
  name: string;
  /** Rendered width hint for the image CDN; defaults to `size`px, else a small card. Pass it whenever the frame is larger. */
  sizes?: string;
  teamColor?: string | null;
  size?: number;
  className?: string;
  priority?: boolean;
  /** Show the credit line under the frame (the F1 CDN is credited in the footer; fallbacks must credit inline). */
  showCredit?: boolean;
}) {
  return (
    <Portrait
      src={src}
      fallbackSrc={fallbackSrc}
      fallbackCredit={fallbackCredit}
      credit={showCredit && src ? { label: 'Formula 1 media' } : null}
      name={name}
      framing="head"
      teamColor={teamColor}
      priority={priority}
      sizes={sizes ?? (size ? `${size}px` : '(max-width: 640px) 50vw, 240px')}
      emptyLabel={size && size < 72 ? null : 'Photo unavailable'}
      className={cn('shrink-0', className)}
      style={size ? { width: size } : undefined}
    />
  );
}
