import { cn } from '@apex/ui';
import { WireImage } from '@/components/news/WireImage';
import type { HeroTile } from './hero-visual';

/**
 * Real pictures in a page hero (HNV-3): the newest story photos on /latest,
 * the newest video posters on /video. One large 16:9 picture over two
 * smaller ones, each whole (the no-crop rule decides cover or contain), each
 * a link to the story or video. A picture that fails removes its own tile;
 * nothing is invented in its place. Publisher credit is the meta line, as
 * on every news card.
 */
export function HeroMosaic({ tiles, label, className }: { tiles: HeroTile[]; label: string; className?: string }) {
  if (tiles.length === 0) return null;
  return (
    <ul aria-label={label} data-hero-mosaic className={cn('grid grid-cols-2 gap-2.5 sm:gap-3', className)}>
      {tiles.map((t, i) => (
        <li key={t.key} className={cn('group group/story relative min-w-0 [&:not(:has([data-wire-image]))]:hidden', i === 0 && 'col-span-2', tiles.length === 2 && i === 1 && 'col-span-2')}>
          <a
            href={t.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.label ?? `${t.title} (opens in a new tab)`}
            {...t.attrs}
            className="block rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--bc-red)]"
          >
            <WireImage
              src={t.src}
              alt=""
              kind="wide"
              radius={i === 0 ? 'l' : 'm'}
              priority={i === 0}
              sizes={i === 0 ? '(max-width: 1024px) 92vw, 40vw' : '(max-width: 1024px) 46vw, 20vw'}
            />
            {i === 0 && (
              <span aria-hidden className="mt-2.5 line-clamp-2 block text-[0.88rem] font-semibold leading-snug text-[color:var(--bc-white)] decoration-[color:var(--bc-red)] decoration-2 underline-offset-[0.18em] group-hover/story:underline">
                {t.title}
              </span>
            )}
            {t.meta && <span aria-hidden className="mt-1 block truncate text-[0.75rem] text-[color:var(--bc-titanium)]">{t.meta}</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
