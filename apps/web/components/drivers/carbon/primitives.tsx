import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import '@/components/brand-c/brand-c.css';
import './drivers.css';
import { ScrollMotion } from '@/components/brand-c/ScrollMotion';
import { Portrait, type PortraitFraming } from '@/components/ds/Portrait';
import { cloudinaryAspect, f1FramedCutout, isPhotograph } from '@/lib/f1-media-urls';
import { normalizeHex } from '@/components/ds/color';
import { fitSize } from '../fit';

/**
 * The drivers pages in Carbon & Light: the brand scope (.bc tokens, night
 * ground) plus the drivers additions (.dr), and the home's one scroll
 * choreography (ScrollMotion: [data-rv] reveals that start below the fold,
 * [data-count] figures, fine-pointer parallax). Server component.
 */
export function CarbonPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('bc dr relative', className)}>
      {children}
      <ScrollMotion />
    </div>
  );
}

/** Red rule + label: the section kicker used across the home. */
export function Kicker({ children, className, as: Tag = 'p' }: { children: ReactNode; className?: string; as?: 'p' | 'div' }) {
  return (
    <Tag className={cn('bc-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]', className)}>
      <span aria-hidden className="h-[2px] w-8 shrink-0 bg-[color:var(--bc-red)]" />
      {children}
    </Tag>
  );
}

/** A team colour as a small vertical light bar (identity mark beside text, never the text colour). */
export function TeamBar({ color, className }: { color: string | null | undefined; className?: string }) {
  return <span aria-hidden className={cn('inline-block h-4 w-[3px] shrink-0 rounded-full', className)} style={{ backgroundColor: normalizeHex(color) ?? 'rgb(255 255 255 / 0.3)' }} />;
}

/** Section heading block: kicker, display title, optional lead. */
export function SectionHead({ kicker, title, id, lead, className, children }: { kicker?: ReactNode; title: ReactNode; id?: string; lead?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-10 gap-y-6', className)}>
      <div className="min-w-0 max-w-[48rem]">
        {kicker && <Kicker>{kicker}</Kicker>}
        <h2 id={id} className="bc-display mt-4 text-[clamp(2rem,4.4vw,3.6rem)] [text-wrap:balance]">{title}</h2>
        {lead && <p className="mt-4 max-w-[60ch] text-[1.02rem] leading-relaxed text-[color:var(--bc-silver)]">{lead}</p>}
      </div>
      {children}
    </div>
  );
}

/** A display word sized to its column by length (never broken mid-word, never clipped). */
export function FitWord({ text, max, fit, className, as: Tag = 'span', id }: { text: string; max: string; fit: string; className?: string; as?: 'span' | 'h1' | 'h2' | 'h3'; id?: string }) {
  const n = Math.max(5, text.length) * 0.94;
  return (
    <Tag id={id} className={cn('bc-display block whitespace-nowrap', className)} style={{ fontSize: `min(${max}, calc(${fit} / ${n.toFixed(2)}))` } as CSSProperties}>
      {text}
    </Tag>
  );
}

/**
 * The shared Portrait (components/ds/Portrait), lit like a studio shoot:
 * a cool key from the upper left, a team-colour rim from the right and a
 * soft top light, each masked by the photo itself so light lands only on the
 * person; an edge highlight and a rim spill; the crop fading into the floor.
 * The Portrait keeps every guarantee (fixed aspect box before load, contain,
 * honest "Photo unavailable" state, load watchdog). Photographs are left as
 * they are (their own light).
 */
export function LitPortrait({
  src,
  fallbackSrc,
  name,
  alt,
  teamColor,
  framing = 'bust',
  ratio,
  priority,
  sizes,
  glyph,
  credit,
  glare,
  emptyLabel,
  className,
  style,
}: {
  src: string | null | undefined;
  fallbackSrc?: string | null;
  name: string;
  alt?: string;
  teamColor?: string | null;
  framing?: PortraitFraming;
  ratio?: string;
  priority?: boolean;
  sizes?: string;
  glyph?: string | null;
  credit?: { label: string; href?: string } | null;
  glare?: boolean;
  emptyLabel?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const frameRatio = ratio ?? (framing === 'head' ? '1 / 1' : framing === 'full' ? '5 / 8' : '4 / 5');
  const cutout = Boolean(src) && !isPhotograph(src);
  const aspect = cloudinaryAspect(frameRatio);
  const maskSrc = src && cutout ? (framing !== 'full' && aspect ? f1FramedCutout(src, aspect, 640) : src) : null;
  const team = normalizeHex(teamColor) ?? '#9b9ea7';
  const vars = { '--team': team, '--src': maskSrc ? `url("${maskSrc}")` : 'none' } as CSSProperties;
  return (
    <div className={cn('dr-lit relative', className)} style={{ ...vars, ...style }}>
      <Portrait
        src={src}
        fallbackSrc={fallbackSrc}
        name={name}
        alt={alt}
        variant={cutout ? 'cutout' : src ? 'photo' : undefined}
        framing={framing}
        ratio={frameRatio}
        teamColor={teamColor}
        priority={priority}
        sizes={sizes}
        glyph={glyph}
        credit={credit}
        glare={glare}
        emptyLabel={emptyLabel}
        inset={framing === 'full' ? '4% 4% 0' : undefined}
      />
      {maskSrc && (
        <div aria-hidden className="dr-light" style={{ aspectRatio: frameRatio, bottom: 'auto', ...(framing === 'full' ? { padding: '4% 4% 0' } : null) }}>
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

/** Mono figure that rolls up from zero the first time it scrolls in (server HTML holds the value). */
export function Count({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const text = new Intl.NumberFormat('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return <span data-count={value} data-dec={decimals} className={cn('bc-mono tabular-nums', className)}>{text}</span>;
}

/** A row of figures in timing mono, (labels in the brand label voice). */
export function Figures({ items, className }: { items: Array<{ label: string; value: number | string; note?: string | null; decimals?: number }>; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 border-t border-white/10 sm:grid-cols-3', items.length > 6 && 'lg:grid-cols-4 xl:grid-cols-7', items.length === 4 && 'sm:grid-cols-4', className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 border-b border-white/10 py-5 pr-4">
          <dt className="bc-label text-[color:var(--bc-titanium)]">{it.label}</dt>
          <dd className="mt-2.5 text-[clamp(1.7rem,3vw,2.5rem)] leading-none text-[color:var(--bc-white)]">
            {typeof it.value === 'number' ? <Count value={it.value} decimals={it.decimals ?? 0} /> : <span className="bc-mono">{it.value}</span>}
          </dd>
          {it.note && <dd className="mt-2 text-[0.875rem] leading-snug text-[color:var(--bc-silver)]">{it.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Page title in the display voice, rising through its mask on first paint.
 * Each word is sized to fit the column by its measured length, so a long word
 * ("CHAMPIONS") steps down in size instead of breaking or clipping.
 */
export function DisplayTitle({ id, text, size = 'clamp(2.6rem, 7.4vw, 6.2rem)', className }: { id: string; text: string; size?: string; className?: string }) {
  return (
    <div style={{ containerType: 'inline-size' }} className={className}>
      <h1 id={id}>
        {/* The size sits on the mask so its em headroom scales with the type (accents and ascenders stay whole). */}
        <span className="bc-mask" style={{ fontSize: fitSize(text, size, { stretch: 1.3 }) }}>
          <span className="bc-in-rise bc-display block text-[color:var(--bc-white)]" style={{ '--d': '120ms' } as CSSProperties}>{text}</span>
        </span>
      </h1>
    </div>
  );
}
