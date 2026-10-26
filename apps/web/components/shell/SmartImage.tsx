"use client";

/**
 * SmartImage: the single hardened <img> every third-party image on Apex
 * routes through.
 *
 *  - Sharpness: every URL is upgraded to the host's best rendition with a
 *    real srcSet (lib/image-renditions), so the browser never upscales a
 *    feed thumbnail when a larger master exists.
 *  - Framing: editorial photos default to `cover` with a focal point.
 *    Logos, headshots and cut-outs opt into `contain`.
 *  - Resolution guard: after decode, an image that would be stretched past
 *    2x its native pixels is shown at native scale on a ruled surface
 *    instead of being blown up into mush. Callers can listen via onMeasure.
 *  - Failure: hotlink 403, dead URLs, YouTube's 120px "no maxres" stub and
 *    junk src values walk the fallback chain, then degrade to a branded
 *    block. Never the browser's broken-image glyph.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { bestRendition } from "@/lib/image-renditions";
import { recoverSettledImage } from "@/lib/settled-image";

const WEDGE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='M0 100 L42 0 L58 0 L100 100 L72 100 L50 34 L28 100 Z' fill='%23e10600' fill-opacity='0.22'/%3E%3C/svg%3E\")";

export interface ImageMeasure {
  naturalWidth: number;
  naturalHeight: number;
  renderedWidth: number;
  /** naturalWidth / (renderedWidth * dpr). Below ~0.6 reads as soft. */
  ratio: number;
}

export interface SmartImageProps {
  src?: string | null;
  /** Empty string = decorative. */
  alt?: string;
  /** Classes for the outer frame (size/position). */
  className?: string;
  /** Extra classes for the <img> itself. */
  imgClassName?: string;
  style?: CSSProperties;
  /** Load immediately for above-the-fold heroes. Defaults to lazy. */
  eager?: boolean;
  /** Optional tint for the fallback block (e.g. team color). */
  accent?: string | null;
  width?: number;
  height?: number;
  sizes?: string;
  /** Default `cover`; `contain` for logos, headshots and cut-outs. */
  fit?: "cover" | "contain";
  /** CSS object-position, e.g. "50% 35%". */
  focal?: string;
  /** Skip the native-scale guard (e.g. decorative textures). */
  allowUpscale?: boolean;
  onMeasure?: (m: ImageMeasure) => void;
  onFail?: () => void;
}

/** Normalize a third-party URL. Returns null for anything unusable. */
export function normalizeImageSrc(src?: string | null): string | null {
  if (!src) return null;
  const t = src.trim();
  if (!t || t === "null" || t === "undefined" || t === "#") return null;
  const resolved = t.startsWith("http://") ? `https://${t.slice(7)}` : t.startsWith("//") ? `https:${t}` : t;
  if (/^https:/i.test(resolved)) {
    try {
      return new URL(resolved).href;
    } catch {
      return null;
    }
  }
  if (/^data:image\//i.test(t) || t.startsWith("blob:")) return t;
  if (t.startsWith("/")) return t;
  return null;
}

function FallbackBlock({ alt, className, style, accent }: { alt: string; className?: string; style?: CSSProperties; accent?: string | null }) {
  return (
    <div
      data-image-state="failed"
      className={className}
      style={{
        ...style,
        backgroundColor: accent || "#121214",
        backgroundImage: `${WEDGE}, linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)`,
        backgroundRepeat: "no-repeat, repeat",
        backgroundPosition: "center, 0 0",
        backgroundSize: "22% auto, 100% 1.5rem",
      }}
      role={alt ? "img" : undefined}
      aria-label={alt ? `${alt} (image unavailable)` : undefined}
      aria-hidden={alt ? undefined : true}
    />
  );
}

export function SmartImage(props: SmartImageProps) {
  const safe = normalizeImageSrc(props.src);
  if (!safe) return <FallbackBlock alt={props.alt ?? ""} className={props.className} style={props.style} accent={props.accent} />;
  return <ImageContent key={safe} {...props} src={safe} />;
}

function ImageContent({
  src,
  alt = "",
  className = "",
  imgClassName = "",
  style,
  eager = false,
  accent,
  width,
  height,
  sizes,
  fit,
  focal,
  allowUpscale = false,
  onMeasure,
  onFail,
}: SmartImageProps & { src: string }) {
  const rendition = useMemo(() => bestRendition(src), [src]);
  const chain = useMemo(() => [rendition.src, ...(rendition.fallbacks ?? []), src].filter((v, i, a) => a.indexOf(v) === i), [rendition, src]);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [soft, setSoft] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  // Callers often pass inline callbacks; keep the latest in refs so the settle
  // effect below does not re-run (and re-report) on every parent render.
  const onMeasureRef = useRef(onMeasure);
  const onFailRef = useRef(onFail);
  useEffect(() => { onMeasureRef.current = onMeasure; onFailRef.current = onFail; }, [onMeasure, onFail]);

  // Legacy callers express fit through className; honour it.
  const resolvedFit: "cover" | "contain" = fit ?? (/\bobject-contain\b/.test(className) ? "contain" : "cover");
  const current = chain[attempt]!;
  const useSrcSet = attempt === 0 ? rendition.srcSet : undefined;

  const advance = useCallback(() => {
    if (attempt + 1 < chain.length) {
      setStatus("loading");
      setSoft(false);
      setAttempt(attempt + 1);
    }
    else {
      setStatus("failed");
      onFailRef.current?.();
    }
  }, [attempt, chain.length]);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    // YouTube answers a missing maxres with a 120x90 grey stub.
    if (img.naturalWidth <= 120 && /ytimg\.com/.test(img.currentSrc)) {
      advance();
      return;
    }
    const rect = img.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ratio = rect.width > 0 ? img.naturalWidth / (rect.width * dpr) : 1;
    setStatus("loaded");
    setSoft(!allowUpscale && resolvedFit === "cover" && ratio < 0.5);
    onMeasureRef.current?.({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, renderedWidth: rect.width, ratio });
  }, [advance, allowUpscale, resolvedFit]);

  // Cached successes and failures can both finish before hydration attaches handlers.
  useEffect(() => {
    recoverSettledImage(imgRef.current, measure, advance);
  }, [current, measure, advance]);

  // A loaded image can move between desktop and phone-sized frames without
  // loading again. Recheck sharpness against the frame without walking the
  // fallback chain or changing the settled loading state.
  useEffect(() => {
    const img = imgRef.current;
    const frame = img?.parentElement;
    if (status !== "loaded" || !img || !frame) return;
    const updateSharpness = () => {
      const renderedWidth = frame.clientWidth;
      if (!renderedWidth || !img.naturalWidth) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const ratio = img.naturalWidth / (renderedWidth * dpr);
      const nextSoft = !allowUpscale && resolvedFit === "cover" && ratio < 0.5;
      setSoft((previous) => previous === nextSoft ? previous : nextSoft);
    };
    const observer = new ResizeObserver(updateSharpness);
    observer.observe(frame);
    window.addEventListener("resize", updateSharpness, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSharpness);
    };
  }, [status, current, allowUpscale, resolvedFit]);

  const positioned = /\b(?:absolute|relative|fixed|sticky)\b/.test(className);
  const frameClass = `${className.replace(/\bobject-(?:cover|contain)\b/g, "")} ${positioned ? "" : "relative"} overflow-hidden`;

  if (status === "failed") return <FallbackBlock alt={alt} className={frameClass} style={style} accent={accent} />;

  // Soft images render at native scale (never enlarged) on a ruled surface.
  const effectiveFit = soft ? "scale-down" : resolvedFit;
  return (
    <div
      className={frameClass}
      style={{
        ...style,
        backgroundColor: accent || "#121214",
        ...(soft ? { backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "100% 1.5rem" } : null),
      }}
      data-image-state={status}
      data-image-soft={soft || undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- third-party hosts need native loading/error handling. */}
      <img
        ref={imgRef}
        src={current}
        srcSet={useSrcSet}
        sizes={useSrcSet ? (sizes ?? (eager ? "100vw" : "(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw")) : undefined}
        alt={alt}
        width={width}
        height={height}
        className={`block h-full w-full ${imgClassName}`}
        style={{
          objectFit: effectiveFit,
          objectPosition: focal ?? style?.objectPosition ?? "center",
          // Never hidden while it loads (a slow host must not leave a blank, invisible
          // picture): the frame's colour shows until the browser paints the image.
        }}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={measure}
        onError={advance}
      />
    </div>
  );
}
