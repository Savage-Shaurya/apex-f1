import type { ApexArticleSummary } from '@apex/db';
import '@/components/brand-c/brand-c.css';
import { Kicker, Masthead, PillLink } from './carbon';
import { OriginalCard } from './OriginalCard';
import { WireList, type WireStory } from './WireStories';

/**
 * The reader with no story to show: the address is unknown, nothing has been
 * published yet, or the article store is down. It says which, in plain words,
 * and hands the reader real stories instead: other Originals when they exist,
 * otherwise the newest wire headlines. Type and real links only.
 */
export function ArticleEmptyState({
  reason,
  originals,
  wire,
}: {
  reason: 'not-found' | 'none-published' | 'storage-unavailable';
  originals: ApexArticleSummary[];
  wire: WireStory[];
}) {
  const copy = {
    'not-found': {
      title: 'No story at this address',
      body: 'The link may be mistyped, or the story is no longer available. More stories from Apex are below.',
    },
    'none-published': {
      title: 'No story here yet',
      body: 'There is nothing to read at this address yet. The newest Formula\u00a01 stories are below.',
    },
    'storage-unavailable': {
      title: 'Story unavailable',
      body: 'This story can’t be shown right now. Please try again in a few minutes.',
    },
  }[reason];

  return (
    <div className="bc tone-carbon relative" data-page="article-empty">
      <Masthead kicker={reason === 'storage-unavailable' ? 'Apex stories · unavailable right now' : 'Apex stories'} title={reason === 'storage-unavailable' ? 'Unavailable' : 'No story'}>
        <h2 className="bc-wide text-[clamp(1.3rem,1rem+1vw,1.8rem)] leading-tight">{copy.title}</h2>
        <p className="mt-3 max-w-[42ch] text-[1.05rem] leading-relaxed text-[color:var(--bc-silver)]">{copy.body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <PillLink href="/latest" variant="solid">Read the latest news <span aria-hidden>→</span></PillLink>
          <PillLink href="/video">Watch the latest video</PillLink>
        </div>
      </Masthead>

      <div className="ds-container pb-[clamp(4rem,8vw,7rem)]">
        {originals.length > 0 ? (
          <section aria-labelledby="other-originals" className="pt-10">
            <Kicker as="h2" id="other-originals" className="border-b border-white/[0.16] pb-4">More from Apex</Kicker>
            <div className="mt-8 grid gap-x-[var(--gutter)] gap-y-10 md:grid-cols-2 lg:grid-cols-3">
              {originals.map((o) => <OriginalCard key={o.slug} a={o} />)}
            </div>
          </section>
        ) : wire.length > 0 ? (
          <section aria-labelledby="meanwhile" className="grid gap-x-10 gap-y-6 border-t border-white/[0.16] pt-10 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Kicker>Meanwhile on the wire</Kicker>
              <h2 id="meanwhile" className="bc-display mt-4 text-[clamp(1.8rem,3.6vw,3rem)]">The latest Formula 1 news</h2>
            </div>
            <div className="lg:col-span-8">
              <WireList stories={wire} headingLevel={3} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
