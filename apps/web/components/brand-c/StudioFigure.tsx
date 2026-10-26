import type { CSSProperties } from 'react';
import { cn } from '@apex/ui';

/**
 * A transparent F1 cut-out lit like a studio shoot instead of pasted on a
 * box: a team-colour light field behind, a cool key light from the left and
 * a team-colour rim from the right (both masked by the photo itself, so the
 * light lands only on the subject), a soft contact shadow, and a mirror
 * reflection in the gloss floor. The box has the cut-out's exact aspect
 * ratio, so it reserves its space before the image arrives (no shift) and
 * `contain` never crops a face.
 */
export function StudioFigure({
  src,
  name,
  team,
  ratio = '400 / 1150',
  dim = 1,
  reflection = true,
  priority = false,
  className,
  style,
}: {
  src: string | null;
  name: string;
  team: string;
  ratio?: string;
  /** 1 = key subject; lower for figures further back in the scene. */
  dim?: number;
  reflection?: boolean;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const vars = { '--team': team, '--src': src ? `url("${src}")` : 'none', aspectRatio: ratio, ...style } as CSSProperties;
  return (
    <figure className={cn('relative m-0', className)} style={vars}>
      <div aria-hidden className="bc-field absolute left-1/2 top-[6%] h-[62%] w-[260%] -translate-x-1/2 rounded-full opacity-80" />
      <div aria-hidden className="absolute -bottom-[1.5%] left-1/2 h-[4%] w-[150%] -translate-x-1/2 rounded-[50%] bg-black/70 blur-md" />
      {src ? (
        <div className="absolute inset-0" style={{ filter: dim < 1 ? `brightness(${dim}) saturate(${0.6 + dim * 0.4})` : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- CDN rendition chosen by width; box reserves the space */}
          <img src={src} alt={name} decoding="async" fetchPriority={priority ? 'high' : 'auto'} loading={priority ? 'eager' : 'lazy'} className="bc-cutout absolute inset-0 h-full w-full object-contain object-bottom" />
          <div aria-hidden className="bc-lit bc-lit--key" />
          <div aria-hidden className="bc-lit bc-lit--top" />
          <div aria-hidden className="bc-lit bc-lit--rim" />
          {reflection && (
            // eslint-disable-next-line @next/next/no-img-element -- decorative mirror of the same image
            <img src={src} alt="" aria-hidden decoding="async" loading="lazy" className="bc-reflect pointer-events-none absolute left-0 top-full h-full w-full object-contain object-bottom" />
          )}
        </div>
      ) : (
        <figcaption className="absolute inset-x-0 bottom-0 grid h-1/2 place-items-center text-center text-sm text-[color:var(--bc-titanium)]">Photo unavailable</figcaption>
      )}
    </figure>
  );
}
