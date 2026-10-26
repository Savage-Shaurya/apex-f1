'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Portrait, type PortraitFraming } from '@/components/ds/Portrait';

/**
 * A stage for an F1 media cut-out, built on the design system's Portrait
 * treatment (components/ds/Portrait.tsx + portrait.css): the team colour as
 * a lit field, a soft floor shadow, and a consistent crop baseline per
 * framing. `full` keeps the whole body with feet on the floor (profile hero,
 * duels); `head` and `bust` let the CDN crop head-and-shoulders or waist-up
 * from the master so every face sits at the same height.
 *
 * Failure path: if the cut-out (and `fallbackSrc`) fail, the stage keeps its
 * size and shows the person's initials, labelled "Driver photo unavailable";
 * `children` replace that state when a caller has a better one.
 */
export function CutoutStage({
  src,
  fallbackSrc,
  glyph,
  teamColor,
  alt,
  name,
  priority = false,
  sizes = '(max-width: 640px) 60vw, 30vw',
  ratio = '5 / 8',
  framing = 'full',
  inset = '5% 5% 0',
  glare = false,
  className,
  style,
  children,
}: {
  src?: string | null;
  fallbackSrc?: string | null;
  glyph?: string | null;
  teamColor?: string | null;
  /** Accessible description; empty string when the name is printed beside it. */
  alt: string;
  /** Person shown, for the initials when there is no picture (defaults to `alt`). */
  name?: string;
  priority?: boolean;
  sizes?: string;
  ratio?: string;
  framing?: PortraitFraming;
  /** Padding around a full-body picture (CSS shorthand); the bottom stays 0 so feet sit on the floor. */
  inset?: string;
  glare?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <Portrait
      src={src}
      fallbackSrc={fallbackSrc}
      name={name ?? alt}
      alt={alt}
      variant="cutout"
      framing={framing}
      ratio={ratio}
      teamColor={teamColor}
      glyph={glyph}
      inset={inset}
      priority={priority}
      sizes={sizes}
      glare={glare}
      empty={children ? <div className="absolute inset-0">{children}</div> : undefined}
      emptyLabel="Driver photo unavailable"
      className={className}
      style={style}
    />
  );
}
