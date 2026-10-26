import type { Metadata } from 'next';
import { getF1ChannelDirectory, getF1Videos } from '@apex/api-client/youtube';
import '@/components/brand-c/brand-c.css';
import { Floodlights } from '@/components/brand-c/stages';
import { CarbonNotice, Kicker, Masthead } from '@/components/news/carbon';
import { FilterRail, stickyRailScrollMargin, type FilterItem } from '@/components/news/FilterRail';
import { StickyRail } from '@/components/news/StickyRail';
import { plural } from '@/components/news/news-format';
import { FeaturedVideo, UpNextRow, VideoTile } from '@/components/video/VideoCards';
import { FocusRail } from '@/components/video/FocusRail';
import { isOnTopicForChannel, pickFeatured, toVideoView } from '@/components/video/video-model';
import { scalarPublicQuery } from '@/lib/public-query';
import { withSocial } from '@/lib/page-metadata';
import { outageConnection } from '@/lib/outage-connection';

export const revalidate = 1800;

export const metadata: Metadata = withSocial({
  title: 'Formula 1 video',
  description: 'The latest Formula 1 videos from verified F1 YouTube channels, including the official FORMULA 1 channel, newest first.',
  alternates: { canonical: '/video' },
});

type SortKey = 'newest' | 'most-viewed';
const UP_NEXT = 5;

export default async function VideoPage(props: { searchParams: Promise<{ channel?: string | string[]; sort?: string | string[] }> }) {
  const params = await props.searchParams;
  const requestedSort: SortKey = scalarPublicQuery(params.sort) === 'most-viewed' ? 'most-viewed' : 'newest';
  // Labels are each channel's live YouTube title (channels.list snippet.title).
  const directory = await getF1ChannelDirectory();
  const activeChannel = directory.find((c) => c.slug === scalarPublicQuery(params.channel)?.toLowerCase());

  const raw = await getF1Videos({
    channels: activeChannel ? [activeChannel] : directory,
    // A larger pool gives "most viewed" real signal, not just the newest 24.
    limit: requestedSort === 'most-viewed' ? 48 : 24,
    revalidate: 1800,
  });
  const slugByChannel = new Map(directory.flatMap((c) => [[c.title.toLowerCase(), c.slug], [c.name.toLowerCase(), c.slug]] as const));
  const videos = raw.map(toVideoView).filter((v) => isOnTopicForChannel(v.title, slugByChannel.get(v.channel.toLowerCase())));
  const anyViews = videos.some((v) => v.viewCount !== null);
  const sort: SortKey = requestedSort === 'most-viewed' && anyViews ? 'most-viewed' : 'newest';
  const sorted = [...videos].sort((a, b) => {
    if (sort === 'most-viewed') {
      if (a.viewCount === null && b.viewCount === null) return b.publishedMs - a.publishedMs;
      if (a.viewCount === null) return 1;
      if (b.viewCount === null) return -1;
      return b.viewCount - a.viewCount || b.publishedMs - a.publishedMs;
    }
    return b.publishedMs - a.publishedMs;
  }).slice(0, 24);
  // Lead with a video (nearly) every reader can play here, never an allow-listed clip or an unstarted stream.
  const featured = pickFeatured(sorted);
  // Nothing came back at all: YouTube did not answer (every channel always has uploads).
  const noAnswer = raw.length === 0;
  // An outage is never cached for the 30-minute window: render it per request until YouTube answers (D2-RESILIENCE-4).
  if (noAnswer) await outageConnection();
  // Says why this video leads, so the choice is never a mystery.
  const kicker = sort === 'most-viewed'
    ? `Most watched of the newest ${videos.length}`
    : featured && featured.publishedMs === sorted[0]?.publishedMs
      ? 'Newest upload'
      : 'Newest upload that plays in nearly every country';
  const rest = sorted.filter((v) => v !== featured);
  const upNext = rest.slice(0, UP_NEXT);
  const grid = rest.slice(UP_NEXT);

  const href = (next: { channel?: string | null; sort?: SortKey }) => {
    const sp = new URLSearchParams();
    const channel = next.channel === null ? undefined : (next.channel ?? activeChannel?.slug);
    const s = next.sort ?? sort;
    if (channel) sp.set('channel', channel);
    if (s !== 'newest') sp.set('sort', s);
    const q = sp.toString();
    return q ? `/video?${q}` : '/video';
  };
  const channelItems: FilterItem[] = [
    { href: href({ channel: null }), label: 'All channels', current: !activeChannel },
    ...directory.map((c) => ({ href: href({ channel: c.slug }), label: c.title, current: activeChannel?.slug === c.slug })),
  ];
  const sortItems: FilterItem[] = [
    { href: href({ sort: 'newest' }), label: 'Newest', current: sort === 'newest' },
    { href: href({ sort: 'most-viewed' }), label: 'Most viewed', current: sort === 'most-viewed' },
  ];

  return (
    <div className={`bc relative ${stickyRailScrollMargin}`} data-page="video">
      <Masthead
        kicker={<>Screening room · {plural(directory.length, 'channel')}</>}
        title="Video"
        light={<Floodlights className="absolute inset-0" />}
      >
        <p className="max-w-[40ch] text-[clamp(1.02rem,0.95rem+0.3vw,1.18rem)] leading-relaxed text-[color:var(--bc-silver)]">
          {sort === 'most-viewed'
            ? activeChannel
              ? <>The most watched of the newest {plural(videos.length, 'upload')} from {activeChannel.title}.</>
              : <>The most watched of the newest {plural(videos.length, 'upload')} from {plural(directory.length, 'Formula 1 channel')}.</>
            : activeChannel
              ? <>The newest uploads from {activeChannel.title}.</>
              : <>The newest uploads from {plural(directory.length, 'Formula 1 channel')}, on one screen.</>}
        </p>
        <p className="mt-3 max-w-[52ch] text-[0.88rem] text-[color:var(--bc-titanium)]">Most videos play right here. A few open on YouTube.</p>
      </Masthead>

      <StickyRail>
        <div className="ds-container flex min-w-0 flex-col lg:flex-row lg:gap-10">
          <FilterRail label="Filter by channel" title="Channel" items={channelItems} className="min-w-0 lg:flex-1" />
          {anyViews && <FilterRail label="Sort videos" title="Sort" items={sortItems} className="min-w-0 border-t border-white/[0.06] lg:w-auto lg:shrink-0 lg:border-t-0" />}
        </div>
      </StickyRail>

      {requestedSort === 'most-viewed' && !anyViews && featured && (
        <div className="ds-container mt-8">
          <CarbonNotice tone="unavailable" title="View counts unavailable">
            View counts can&apos;t be shown right now, so the newest videos are shown instead.
          </CarbonNotice>
        </div>
      )}

      {!featured ? (
        <div className="ds-container py-[clamp(3rem,8vw,7rem)]">
          {!noAnswer ? (
            <CarbonNotice title={activeChannel ? `No Formula 1 uploads from ${activeChannel.title} right now` : 'No Formula 1 uploads right now'} action={activeChannel ? { label: 'Show every channel', href: '/video' } : undefined}>
              {activeChannel ? `None of the latest uploads from ${activeChannel.title} are about the Formula 1 World Championship. Check back soon.` : 'None of the latest uploads are about the Formula 1 World Championship. Check back soon.'}
            </CarbonNotice>
          ) : (
            <CarbonNotice tone="unavailable" title="Videos unavailable" action={{ label: 'Try again', href: href({}) }}>
              Videos can&apos;t be shown right now. Please check back in a few minutes.
            </CarbonNotice>
          )}
        </div>
      ) : (
        <>
          <section aria-label={activeChannel ? `Latest from ${activeChannel.title}` : sort === 'most-viewed' ? 'Most viewed video' : 'Featured video'} className="pt-10 md:pt-14">
            <div className="ds-container grid gap-x-10 gap-y-12 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
                <FeaturedVideo v={featured} kicker={kicker} />
              </div>
              {upNext.length > 0 && (
                <section aria-labelledby="up-next-title" className="min-w-0 lg:col-span-4">
                  <Kicker as="h2" id="up-next-title" className="pb-2 lg:border-b lg:border-white/[0.16] lg:pb-4">Up next</Kicker>
                  {/* Below 1024px a sideways rail of whole posters; vertical wheels and swipes over it still move the page. Proximity snapping and scroll padding keep a keyboard-focused card fully in view with its focus ring inside the rail (R3-A11Y-2, A11Y-6). */}
                  <FocusRail className="-mx-[var(--page-margin)] mt-4 flex snap-x snap-proximity scroll-px-[var(--page-margin)] gap-4 overflow-x-auto overflow-y-hidden px-[var(--page-margin)] py-2 pb-3 [scrollbar-width:thin] lg:mx-0 lg:mt-0 lg:block lg:snap-none lg:overflow-visible lg:p-0">
                    {upNext.map((v) => (
                      <li key={v.key} className="shrink-0 snap-start lg:border-b lg:border-white/[0.08]">
                        <UpNextRow v={v} />
                      </li>
                    ))}
                  </FocusRail>
                </section>
              )}
            </div>
          </section>

          {grid.length > 0 && (
            <section aria-labelledby="more-videos" className="pt-[clamp(4rem,9vw,8rem)]">
              <div className="ds-container">
                <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/[0.16] pb-5">
                  <div>
                    <Kicker>{sort === 'most-viewed' ? 'Ranked by views' : 'Newest first'}</Kicker>
                    <h2 id="more-videos" className="bc-display mt-4 text-[clamp(2rem,4.6vw,3.8rem)]">{sort === 'most-viewed' ? 'Most viewed' : 'More uploads'}</h2>
                  </div>
                  <span className="bc-mono shrink-0 pb-1 text-[0.8rem] text-[color:var(--bc-titanium)]">{plural(grid.length, 'video')}</span>
                </div>
                <ul className="mt-10 grid gap-x-[var(--gutter)] gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                  {grid.map((v) => (
                    <li key={v.key} className="min-w-0">
                      <VideoTile v={v} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <div aria-hidden className="pb-[clamp(4rem,8vw,7rem)]" />
    </div>
  );
}
