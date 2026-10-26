import { cn } from '@apex/ui';
import { MetaItem, MetaLine } from '@/components/news/MetaLine';
import { RelativeTime } from '@/components/news/RelativeTime';
import { VideoPoster } from './VideoPoster';
import { playName, playerAttributes, type VideoView } from './video-model';

/**
 * The screening room's cards. Each card is one link to the YouTube watch
 * page: with JavaScript and an embeddable video, the shared
 * VideoPlayerModal catches the click (via the data-apex-video-* attributes)
 * and plays it on Apex; otherwise the link opens YouTube in a new tab and
 * says so. Posters are whole 16:9 pictures with nothing printed on them
 * (YouTube posters carry their own titles); the facts sit underneath.
 * Every play link carries one accessible name from playName().
 */

const TITLE_LINK = "after:absolute after:inset-0 after:z-[2] after:content-[''] decoration-[color:var(--bc-red)] decoration-2 underline-offset-[0.18em] focus-visible:outline-none group-hover/story:underline [&:focus-visible]:underline";

function VideoLink({ v, className, children }: { v: VideoView; className?: string; children: React.ReactNode }) {
  return (
    <a href={v.url} target="_blank" rel="noopener noreferrer" {...playerAttributes(v)} aria-label={playName(v)} className={cn(TITLE_LINK, className)}>
      {children}
    </a>
  );
}

function PlayGlyph({ external, className }: { external: boolean; className?: string }) {
  return external
    ? <svg viewBox="0 0 16 16" aria-hidden className={className}><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg viewBox="0 0 16 16" aria-hidden className={className}><path d="M5 3.2v9.6L12.8 8z" fill="currentColor" /></svg>;
}

/** Channel, running time, age and views, below the poster. The running time is spoken in the play link's name. */
function VideoMeta({ v, className, compact = false }: { v: VideoView; className?: string; compact?: boolean }) {
  const facts: Array<{ key: string; node: React.ReactNode; className?: string }> = [];
  if (!compact) facts.push({ key: 'channel', node: v.channel, className: 'font-semibold text-[color:var(--bc-white)]' });
  if (v.duration) {
    facts.push({
      key: 'duration',
      className: 'bc-mono inline-flex items-center gap-1 whitespace-nowrap text-[color:var(--bc-silver)]',
      node: (
        <>
          <PlayGlyph external={!v.embeddable} className="size-3 shrink-0 text-[color:var(--bc-red-text)]" />
          <span aria-hidden>{v.duration}</span>
        </>
      ),
    });
  }
  if (v.publishedMs > 0) facts.push({ key: 'time', node: <RelativeTime ms={v.publishedMs} />, className: 'whitespace-nowrap' });
  if (v.views) facts.push({ key: 'views', node: v.views, className: 'whitespace-nowrap' });
  return (
    <MetaLine className={className}>
      {facts.map((f) => <MetaItem key={f.key} className={f.className}>{f.node}</MetaItem>)}
    </MetaLine>
  );
}

/** Play mark that rises while the card is hovered or focused, so it never sits on the poster at rest. */
function HoverPlay({ v, size = 'm' }: { v: VideoView; size?: 's' | 'm' }) {
  return (
    <span aria-hidden className="absolute inset-0 z-[1] flex items-center justify-center bg-black/0 opacity-0 transition-[opacity,background-color] duration-300 group-hover/story:bg-black/25 group-hover/story:opacity-100 group-focus-within/story:bg-black/25 group-focus-within/story:opacity-100 motion-reduce:transition-none">
      <span className={cn('grid place-items-center rounded-full bg-[color:var(--bc-red)] text-white shadow-[0_10px_30px_-8px_rgb(225_6_0/0.7)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/story:scale-100 motion-reduce:transform-none', size === 's' ? 'size-9 scale-90' : 'size-14 scale-90')}>
        <PlayGlyph external={!v.embeddable} className={size === 's' ? 'size-4' : 'size-5'} />
      </span>
    </span>
  );
}

/**
 * The featured video, on the big screen: the poster whole in a lit frame
 * (a cool projector glow falls on it from above), the title below, a red
 * play pill as the one primary action.
 */
export function FeaturedVideo({ v, kicker }: { v: VideoView; kicker?: string }) {
  return (
    <article className="group group/story relative min-w-0">
      <div className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-14 lg:-inset-x-6 bottom-1/2 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.13),transparent)]" />
        {/* The poster repeats the play link for pointer users; keyboard and screen readers use the buttons below. */}
        <a href={v.url} target="_blank" rel="noopener noreferrer" {...playerAttributes(v)} tabIndex={-1} aria-hidden className="block">
          <VideoPoster src={v.thumbnail} priority radius="l" sizes="(max-width: 1024px) 100vw, 62vw" className="shadow-[0_50px_120px_-50px_rgb(233_240_255/0.35)]">
            <span aria-hidden className="absolute inset-0 z-[1] flex items-center justify-center">
              <span className="grid size-16 place-items-center rounded-full bg-[color:var(--bc-red)] text-white shadow-[0_16px_50px_-10px_rgb(225_6_0/0.8)] ring-[10px] ring-black/25 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/story:scale-110 motion-reduce:transform-none md:size-20">
                <PlayGlyph external={!v.embeddable} className="size-7 translate-x-[1px]" />
              </span>
            </span>
          </VideoPoster>
        </a>
      </div>
      <div className="mt-6 min-w-0">
        {kicker && <p className="bc-label mb-3 flex items-center gap-3 text-[color:var(--bc-red-text)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />{kicker}</p>}
        <VideoMeta v={v} />
        <h2 className="mt-3 max-w-[30ch] text-[clamp(1.5rem,1rem+1.8vw,2.4rem)] font-semibold leading-[1.12] text-[color:var(--bc-white)] text-balance">{v.title}</h2>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={v.url}
            target="_blank"
            rel="noopener noreferrer"
            {...playerAttributes(v)}
            aria-label={playName(v, v.embeddable ? 'Play video' : 'Watch on YouTube')}
            className="relative z-[3] inline-flex min-h-12 items-center gap-2.5 rounded-full bg-[color:var(--bc-red)] px-6 text-[0.95rem] font-semibold text-white transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 hover:bg-[#f01a12] active:scale-[0.96] motion-reduce:transform-none"
          >
            <PlayGlyph external={!v.embeddable} className="size-4" />
            <span>{v.embeddable ? 'Play video' : 'Watch on YouTube'}</span>
          </a>
          {v.embeddable && (
            <a href={v.url} target="_blank" rel="noopener noreferrer" className="relative z-[3] inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-[0.9rem] font-medium text-[color:var(--bc-white)] ring-1 ring-white/30 transition-colors hover:bg-white/[0.04] hover:ring-white/60">
              Open at YouTube <span aria-hidden>↗</span><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
        {v.regionNote && <p className="mt-4 max-w-[65ch] text-[0.9rem] text-[color:var(--bc-titanium)]">{v.regionNote}, by the channel&apos;s choice on YouTube.</p>}
      </div>
    </article>
  );
}

/** Grid card: whole 16:9 poster, title and facts below it (never on the picture). */
export function VideoTile({ v }: { v: VideoView }) {
  return (
    <article className="group group/story relative flex min-w-0 flex-col gap-4">
      <VideoPoster src={v.thumbnail} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 30vw" className="transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/story:-translate-y-1 group-hover/story:shadow-[0_30px_60px_-30px_rgb(233_240_255/0.3)] motion-reduce:transform-none">
        <HoverPlay v={v} />
      </VideoPoster>
      <div className="min-w-0">
        <VideoMeta v={v} />
        <h3 className="mt-2 text-[1.05rem] font-semibold leading-snug text-[color:var(--bc-white)] text-pretty">
          <VideoLink v={v}>{v.title}</VideoLink>
        </h3>
      </div>
    </article>
  );
}

/**
 * "Up next": on wide screens a column beside the screen (poster left,
 * title right); below 1024px a swipe rail of whole posters. The rail
 * scrolls sideways only: vertical wheels and swipes over it always move the
 * page (no overscroll containment, no vertical overflow).
 */
export function UpNextRow({ v }: { v: VideoView }) {
  return (
    <article className="group group/story relative grid w-[min(17rem,72vw)] min-w-0 gap-3 lg:w-auto lg:grid-cols-[9.5rem_minmax(0,1fr)] lg:items-start lg:gap-4 lg:py-3.5 xl:grid-cols-[11rem_minmax(0,1fr)]">
      <VideoPoster src={v.thumbnail} sizes="(max-width: 1024px) 272px, 176px">
        <HoverPlay v={v} size="s" />
      </VideoPoster>
      <div className="min-w-0">
        <p className="text-[0.78rem] font-semibold text-[color:var(--bc-silver)]">{v.channel}</p>
        <h3 className="mt-1 text-[0.98rem] font-semibold leading-snug text-[color:var(--bc-white)] text-pretty">
          <VideoLink v={v}>{v.title}</VideoLink>
        </h3>
        <VideoMeta v={v} compact className="mt-1.5" />
      </div>
    </article>
  );
}
