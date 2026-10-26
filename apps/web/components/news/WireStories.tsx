import type { ReactNode } from 'react';
import { cn } from '@apex/ui';
import { trimSummary } from '@/components/ds';
import { WireImage } from './WireImage';
import { RelativeTime } from './RelativeTime';
import { LocalClock } from './LocalClock';
import { MetaItem, MetaLine } from './MetaLine';
import type { AlsoAt } from './news-format';

/**
 * Wire story layouts for /latest and the article page's related list, in
 * Carbon & Light.
 *
 * Every story is a publisher's article: the whole card is one external link
 * (the headline is its accessible name, and it says it opens a new tab).
 * Pictures are the publisher's own; when one is missing or fails, the card
 * closes up into its text layout instead of showing a placeholder.
 */
export interface WireStory {
  title: string;
  href: string;
  source: string;
  publishedMs: number;
  summary?: string;
  imageUrl?: string | null;
  /** Extra provider facts shown in the meta line (language). */
  notes?: string[];
  /** Other publishers that ran this same syndicated story. */
  alsoAt?: AlsoAt[];
}

/** Headline link: underline in Signal Red on hover or focus; the ::after makes the whole card the link. */
const HEADLINE_LINK = 'after:absolute after:inset-0 after:z-[2] after:content-[""] decoration-[color:var(--bc-red)] decoration-2 underline-offset-[0.18em] focus-visible:outline-none group-hover/story:underline [&:focus-visible]:underline';

function StoryLink({ story, className, children }: { story: WireStory; className?: string; children?: ReactNode }) {
  return (
    <a href={story.href} target="_blank" rel="noopener noreferrer" className={cn(HEADLINE_LINK, className)}>
      {children ?? story.title}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Card shell: carries both group names (the glare streak listens to `group`). */
const CARD = 'group group/story relative min-w-0';

/**
 * Publisher, age and provider notes. Separators never dangle when the line
 * wraps (see MetaLine), and the outbound arrow is glued to the last fact so
 * it never sits alone on a line.
 */
export function StoryMeta({ story, className, showIcon = true }: { story: WireStory; className?: string; showIcon?: boolean }) {
  const icon = showIcon ? (
    <span aria-hidden className="ml-1.5 inline-block text-[color:var(--bc-titanium)] transition-transform duration-300 group-hover/story:-translate-y-0.5 group-hover/story:translate-x-0.5 motion-reduce:transition-none">↗</span>
  ) : null;
  const facts: ReactNode[] = [
    <span key="source" className="font-semibold text-[color:var(--bc-white)]">{story.source}</span>,
    ...(story.publishedMs > 0 ? [<RelativeTime key="time" ms={story.publishedMs} />] : []),
    ...(story.notes ?? []).map((note) => <span key={`note-${note}`}>{note}</span>),
  ];
  return (
    <MetaLine className={className}>
      {facts.map((fact, i) => (
        <MetaItem key={i} className={i === facts.length - 1 ? 'whitespace-nowrap' : undefined}>
          {fact}
          {i === facts.length - 1 && icon}
        </MetaItem>
      ))}
    </MetaLine>
  );
}

/**
 * "Also at Autosport": the syndicated copies folded into this story, each a
 * real link above the card's full-card link, so no publisher is hidden.
 */
export function AlsoAtLine({ story, className }: { story: WireStory; className?: string }) {
  if (!story.alsoAt?.length) return null;
  return (
    <p className={cn('relative z-[3] flex flex-wrap items-center gap-x-2 text-[0.8rem] text-[color:var(--bc-titanium)]', className)}>
      <span>Also at</span>
      {story.alsoAt.map((copy, i) => (
        <span key={copy.href} className="contents">
          {i > 0 && <span aria-hidden>·</span>}
          <a href={copy.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center font-semibold text-[color:var(--bc-silver)] underline decoration-white/25 underline-offset-[0.25em] transition-colors hover:text-white hover:decoration-[color:var(--bc-red)]">
            {copy.source}
            <span className="sr-only"> (same story, opens in a new tab)</span>
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * The page's top story, lit like the home hero: the publisher's picture as
 * a wide screen with a cool floodlight pooling behind it, the headline set
 * large beside it on wide screens and under it on phones.
 */
export function WireLead({ story, headingLevel = 2 }: { story: WireStory; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className={cn(CARD, 'grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-10')}>
      {story.imageUrl && (
        <div className="relative lg:col-span-8">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 lg:-inset-x-8 bottom-1/3 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(233_240_255/0.10),transparent)]" />
          <WireImage src={story.imageUrl} alt="" kind="wide" radius="l" priority sizes="(max-width: 1024px) 100vw, 62vw" />
        </div>
      )}
      <div className={cn('min-w-0', story.imageUrl ? 'lg:col-span-4 lg:pb-8' : 'lg:col-span-9')}>
        <p className="bc-label flex items-center gap-3 text-[color:var(--bc-red-text)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Lead story</p>
        <StoryMeta story={story} className="mt-4" />
        <H className="mt-3 text-[clamp(1.6rem,1rem+2.1vw,2.55rem)] font-semibold leading-[1.12] text-[color:var(--bc-white)] text-balance">
          <StoryLink story={story} />
        </H>
        {story.summary && <p className="mt-4 max-w-[54ch] text-[1.02rem] leading-relaxed text-[color:var(--bc-silver)] text-pretty">{trimSummary(story.summary, 220)}</p>}
        <p aria-hidden className="relative z-[1] mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[color:var(--bc-white)] px-5 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover/story:-translate-y-0.5 motion-reduce:transform-none">
          Read at {story.source} <span>↗</span>
        </p>
        <AlsoAtLine story={story} className="mt-4" />
      </div>
    </article>
  );
}

/** Full-width spread inside a day: picture on one side (alternating), story on the other. */
export function WireSpread({ story, flip = false }: { story: WireStory; flip?: boolean }) {
  return (
    <article className={cn(CARD, 'grid gap-5 border-b border-white/[0.08] py-9 md:gap-6 lg:col-span-2 lg:grid-cols-12 lg:items-center lg:gap-x-10')}>
      {story.imageUrl && (
        <WireImage src={story.imageUrl} alt="" kind="wide" sizes="(max-width: 1024px) 100vw, 55vw" className={cn('lg:col-span-7', flip && 'lg:order-2')} />
      )}
      <div className={cn('min-w-0 lg:col-span-5', flip && 'lg:order-1')}>
        <StoryMeta story={story} />
        <h3 className="mt-3 max-w-[34ch] text-[clamp(1.35rem,1rem+1.2vw,1.85rem)] font-semibold leading-[1.18] text-[color:var(--bc-white)] text-pretty">
          <StoryLink story={story} />
        </h3>
        {story.summary && <p className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed text-[color:var(--bc-silver)]">{trimSummary(story.summary, 240)}</p>}
        <AlsoAtLine story={story} className="mt-4" />
      </div>
    </article>
  );
}

/**
 * Half-width row: thumbnail beside the story. Below 1024px the thumbnail
 * floats right and the headline wraps around and then under it, newspaper
 * style. From 1024px it is a two-column grid with the picture on the left.
 */
export function WireRow({ story }: { story: WireStory }) {
  return (
    <article
      className={cn(
        CARD,
        'flow-root border-b border-white/[0.08] py-6',
        'lg:grid lg:items-start lg:gap-6 lg:has-[[data-wire-image]]:grid-cols-[11rem_minmax(0,1fr)] xl:has-[[data-wire-image]]:grid-cols-[13rem_minmax(0,1fr)]',
      )}
    >
      {story.imageUrl && (
        <WireImage
          src={story.imageUrl}
          alt=""
          kind="photo"
          sizes="(max-width: 640px) 112px, (max-width: 1024px) 160px, 208px"
          className="float-right mb-2 ml-4 w-28 sm:ml-6 sm:w-40 lg:float-none lg:m-0 lg:w-auto"
        />
      )}
      <div className="min-w-0">
        <StoryMeta story={story} />
        <h3 className="mt-2 text-[1.08rem] font-semibold leading-snug text-[color:var(--bc-white)] text-pretty">
          <StoryLink story={story} />
        </h3>
        {story.summary && <p className="mt-2 hidden max-w-[56ch] text-[0.88rem] leading-relaxed text-[color:var(--bc-silver)] lg:block">{trimSummary(story.summary, 150)}</p>}
        <AlsoAtLine story={story} className="mt-2" />
      </div>
    </article>
  );
}

/** Text-only row: the publisher sent no picture, so the headline carries the row alone. */
export function WireTextRow({ story }: { story: WireStory }) {
  return (
    <article className={cn(CARD, 'border-b border-white/[0.08] py-6')}>
      <StoryMeta story={story} />
      <h3 className="mt-2 max-w-[44ch] text-[1.08rem] font-semibold leading-snug text-[color:var(--bc-white)]">
        <StoryLink story={story} />
      </h3>
      {story.summary && <p className="mt-2 max-w-[60ch] text-[0.88rem] leading-relaxed text-[color:var(--bc-silver)]">{trimSummary(story.summary, 170)}</p>}
      <AlsoAtLine story={story} className="mt-2" />
    </article>
  );
}

/**
 * The wire: a time-ordered column like a timing screen. Each story hangs on
 * one hairline under its clock time (the reader's own time zone), newest
 * on top, the newest marked in Signal Red.
 */
export function WireTimeline({ stories, className, headingLevel = 3 }: { stories: WireStory[]; className?: string; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <ol className={cn('relative min-w-0', className)}>
      {stories.map((story, i) => (
        <li key={story.href} className="relative break-inside-avoid">
          <span aria-hidden className="absolute bottom-0 left-[3.6rem] top-0 w-px bg-white/[0.10]" />
          <article className={cn(CARD, 'grid grid-cols-[3.6rem_minmax(0,1fr)] gap-x-5 py-3.5')}>
            <p className="bc-mono pt-[0.15rem] text-[0.8rem] text-[color:var(--bc-silver)]">
              {story.publishedMs > 0 ? <LocalClock ms={story.publishedMs} /> : <span>--:--</span>}
            </p>
            <span aria-hidden className={cn('absolute left-[3.6rem] top-[1.3rem] h-[2px] w-3 -translate-x-1/2', i === 0 ? 'bg-[color:var(--bc-red)]' : 'bg-white/30')} />
            <div className="min-w-0 rounded-[12px] px-3 py-1 -mx-3 transition-colors duration-300 group-hover/story:bg-white/[0.03]">
              <StoryMeta story={story} showIcon={false} />
              <H className="mt-1.5 text-[1rem] font-semibold leading-snug text-[color:var(--bc-white)] text-pretty">
                <StoryLink story={story} />
              </H>
              <AlsoAtLine story={story} className="mt-1.5" />
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}

/** Compact list (the article page's related reading and its empty state). */
export function WireList({ stories, className, headingLevel = 3 }: { stories: WireStory[]; className?: string; headingLevel?: 3 | 4 }) {
  return <WireTimeline stories={stories} className={className} headingLevel={headingLevel} />;
}
