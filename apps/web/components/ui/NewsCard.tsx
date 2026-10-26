'use client';

import { useState } from 'react';
import { cn } from '@apex/ui';
import { SmartImage, normalizeImageSrc } from '@/components/shell/SmartImage';

export interface NewsCardItem {
  title: string;
  href: string;
  source: string;
  image?: string | null;
  dek?: string;
  meta?: string;
}

/**
 * Editorial card in three tiers (formula1.com density): `feature` with the
 * headline over the photograph, `standard` with image above, `compact` as a
 * thumb row. All open the publisher in a new tab and credit the source.
 *
 * News policy (docs/NEWS-POLICY.md): a photo that fails to load is never shown
 * as a broken or placeholder frame. Image-led cards (feature, standard) are
 * removed; compact rows fall back to their text-only form. Wrap cards in an
 * element with `empty:hidden` so a removed card leaves no gap.
 */
export function NewsCard({ item, variant = 'standard', className, eager = false }: { item: NewsCardItem; variant?: 'feature' | 'standard' | 'compact'; className?: string; eager?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const onFail = () => setImageFailed(true);
  if (imageFailed && variant !== 'compact') return null;
  const hasImage = normalizeImageSrc(item.image) !== null;
  const meta = (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-data text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">
      <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere] text-telemetry-red">{item.source}</span>
      {item.meta && <><span aria-hidden>·</span><span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{item.meta}</span></>}
    </span>
  );

  if (variant === 'compact') {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cn('group flex items-start gap-4 py-4', className)}>
        {hasImage && !imageFailed ? (
          <div className="media-zoom relative h-[84px] w-[84px] shrink-0 md:h-24 md:w-24">
            <SmartImage src={item.image} alt="" className="absolute inset-0 h-full w-full" sizes="96px" onFail={onFail} />
          </div>
        ) : (
          <span aria-hidden className="mt-1 h-10 w-[3px] shrink-0 bg-telemetry-red" />
        )}
        <div className="min-w-0">
          {meta}
          <h3 className="mt-2 whitespace-normal [overflow-wrap:anywhere] text-[15px] font-semibold leading-snug text-on-background transition-colors group-hover:text-telemetry-red">{item.title}</h3>
        </div>
      </a>
    );
  }

  // A story without a photo is shown as text, never as a placeholder frame.
  if (!hasImage) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cn('group block border-l-[3px] border-telemetry-red py-1 pl-4', className?.replace(/(?:^|\s)\S*(?:min-)?h-\S+/g, ''))}>
        {meta}
        <h3 className="mt-2.5 whitespace-normal [overflow-wrap:anywhere] text-[17px] font-semibold leading-snug text-on-background transition-colors group-hover:text-telemetry-red">{item.title}</h3>
        {item.dek && <p className="mt-2 whitespace-normal [overflow-wrap:anywhere] text-[14px] leading-relaxed text-on-surface-variant">{item.dek}</p>}
      </a>
    );
  }

  if (variant === 'feature') {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cn('group edge-draw relative block overflow-hidden', className)}>
        <div className="media-zoom absolute inset-0">
          <SmartImage src={item.image} alt="" eager={eager} className="absolute inset-0 h-full w-full" sizes="(min-width: 1024px) 50vw, 100vw" onFail={onFail} />
        </div>
        <div aria-hidden className="scrim-card absolute inset-0" />
        <div className="relative flex min-h-[inherit] flex-col justify-end p-6 md:p-9">
          {meta}
          <h3 className="mt-4 max-w-[22ch] whitespace-normal [overflow-wrap:anywhere] font-display text-[clamp(1.6rem,2.6vw,2.75rem)] font-bold leading-[1.02] tracking-[-0.02em] text-on-background text-balance">{item.title}</h3>
          {item.dek && <p className="mt-4 max-w-[56ch] whitespace-normal [overflow-wrap:anywhere] text-[15px] leading-relaxed text-on-surface-variant">{item.dek}</p>}
        </div>
      </a>
    );
  }

  return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={cn('group edge-draw block', className)}>
      <div className="media-zoom relative aspect-[16/10] w-full">
        <SmartImage src={item.image} alt="" className="absolute inset-0 h-full w-full" sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" onFail={onFail} />
      </div>
      <div className="pt-4">
        {meta}
        <h3 className="mt-2.5 whitespace-normal [overflow-wrap:anywhere] text-[17px] font-semibold leading-snug text-on-background transition-colors group-hover:text-telemetry-red">{item.title}</h3>
      </div>
    </a>
  );
}
