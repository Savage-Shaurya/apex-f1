'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';

/**
 * A YouTube poster, whole, in a 16:9 frame. YouTube posters are 16:9
 * pictures (the 4:3 sd/hq fallbacks are the same picture with black bars),
 * so `cover` never cuts the subject: it only trims the bars. SmartImage
 * walks maxres, sd, hq. If every rendition fails the frame keeps its size
 * and says so in words. `children` are overlays (the play mark), never text
 * on the picture itself.
 */
export function VideoPoster({ src, sizes, priority = false, radius = 'm', className, children }: { src: string; sizes: string; priority?: boolean; radius?: 'm' | 'l'; className?: string; children?: ReactNode }) {
  const [failed, setFailed] = useState(!src);
  return (
    <div
      className={cn('relative isolate aspect-video overflow-hidden bg-[color:var(--bc-carbon-2,#111114)] ring-1 ring-white/10', radius === 'l' ? 'rounded-[22px]' : 'rounded-[14px]', className)}
      data-media-state={failed ? 'unavailable' : undefined}
    >
      {failed ? (
        <div className="absolute inset-0 flex items-end p-3">
          <span className="text-[0.78rem] text-[color:var(--bc-titanium,#9b9ea7)]">Thumbnail unavailable</span>
        </div>
      ) : (
        <div className="absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/story:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/story:scale-100">
          <SmartImage src={src} alt="" eager={priority} sizes={sizes} fit="cover" className="absolute inset-0" onFail={() => setFailed(true)} />
        </div>
      )}
      <span aria-hidden className="bc-glare z-[1]" />
      {children}
    </div>
  );
}
