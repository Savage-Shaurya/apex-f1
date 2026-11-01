'use client';

import { useCallback, useState } from 'react';
import { WireImage } from '@/components/news/WireImage';
import { TeamEmblem } from './TeamEmblem';

/**
 * A historic team's Commons car photograph in the team hero. WireImage
 * removes itself when the photo fails (a news card closes up); a hero must
 * never be left without a picture, so a failed photo is replaced by the
 * team's emblem in light (review 2026-11-01).
 */
export function TeamHeroPhoto({ src, alt, name, compact }: { src: string; alt: string; name: string; compact: boolean }) {
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  if (failed) return <TeamEmblem name={name} compact={compact} />;
  return (
    <figure className={`relative mx-auto ${compact ? 'max-w-[720px]' : 'max-w-[920px]'} lg:mt-2`} data-team-photo>
      <div aria-hidden className="pointer-events-none absolute -inset-x-[8%] -bottom-[12%] top-[20%] -z-10 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--team)_26%,rgb(233_240_255/0.08)),transparent)]" />
      <WireImage src={src} alt={alt} kind="wide" radius="l" priority zoom={false} sizes={compact ? '(max-width: 780px) 92vw, 720px' : '(max-width: 1000px) 92vw, 920px'} onFail={fail} />
    </figure>
  );
}
