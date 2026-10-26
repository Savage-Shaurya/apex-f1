import type { Metadata } from 'next';
import { outageConnection } from '@/lib/outage-connection';
import { getAggregatedF1NewsResult } from '@apex/api-client';
import { ArticleStorageUnavailable, getPublishedArticles } from '@apex/db';
import { F1_RSS_SOURCES, type RssItem } from '@apex/api-client/rss';
import type { NewsDataLanguageIso, NewsDataSentiment } from '@apex/api-client/newsdata';
import '@/components/brand-c/brand-c.css';
import { FilterRail, stickyRailScrollMargin, type FilterItem } from '@/components/news/FilterRail';
import { StickyRail } from '@/components/news/StickyRail';
import { WireLead, WireRow, WireSpread, WireTextRow, WireTimeline, type WireStory } from '@/components/news/WireStories';
import { OriginalsBand } from '@/components/news/OriginalCard';
import { CarbonNotice, Kicker, Masthead, Pager } from '@/components/news/carbon';
import { DayStream, type DayEntry } from '@/components/news/DayStream';
import { RelativeTime } from '@/components/news/RelativeTime';
import {
  cleanHeadline,
  cleanSummary,
  collapseSyndicated,
  paginate,
  parsePage,
  plural,
  renderTime,
  streamLayout,
} from '@/components/news/news-format';
import { scalarPublicQuery } from '@/lib/public-query';
import { withSocial } from '@/lib/page-metadata';

export const revalidate = 300;

export const metadata: Metadata = withSocial({
  title: 'Latest Formula 1 news',
  description:
    'The latest Formula 1 World Championship stories from trusted newsrooms, newest first.',
  alternates: { canonical: '/latest' },
});

const PER_PAGE = 24;
const RECENT = 6;
/** A last page shorter than this joins the page before it. */
const ORPHANS = 6;

/**
 * Publisher filters. Every story carries its real publisher as `source` (the
 * news policy relabels API rows to the outlet that wrote them), so readers
 * filter by newsroom: Autosport, ESPN, RACER, never "NewsAPI".
 */
function publisherSlug(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Publishers with their own feed report (an RSS feed, or The Guardian's API). */
const REPORTED_PUBLISHERS = [...F1_RSS_SOURCES.map((s) => s.name), 'The Guardian'];

const LANGUAGE_LABEL: Record<NewsDataLanguageIso, string> = { en: 'English', it: 'Italian', es: 'Spanish', de: 'German', fr: 'French', pt: 'Portuguese' };
const LANGUAGE_ORDER: NewsDataLanguageIso[] = ['en', 'it', 'es', 'de', 'fr', 'pt'];
const SENTIMENT_LABEL: Record<NewsDataSentiment, string> = { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' };
const SENTIMENT_ORDER: NewsDataSentiment[] = ['positive', 'neutral', 'negative'];

/** Why a single-publisher filter is empty, in reader terms. */
function sourceEmptyReason(label: string, state: string | undefined): string {
  if (state === 'rejected' || state === 'unavailable' || state === 'unconfigured' || state === 'disabled') {
    return `Stories from ${label} can’t be shown right now. Please check back in a few minutes.`;
  }
  return `${label} has no new Formula 1 stories right now. Check back soon.`;
}

function pickEnum<T extends string>(raw: string | undefined, allowed: readonly T[]): T | null {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

function buildHref(params: { source?: string | null; language?: string | null; sentiment?: string | null; page?: number }): string {
  const sp = new URLSearchParams();
  if (params.source) sp.set('source', params.source);
  if (params.language) sp.set('lang', params.language);
  if (params.sentiment) sp.set('sentiment', params.sentiment);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const q = sp.toString();
  return q ? `/latest?${q}` : '/latest';
}

function toStory(it: RssItem): WireStory {
  // Language is a fact about the story; the provider's tone label stays a filter only.
  const notes = it.language && it.language !== 'en' ? [LANGUAGE_LABEL[it.language]] : [];
  return {
    title: cleanHeadline(it.title, it.source),
    href: it.link,
    source: it.source,
    publishedMs: it.pubDateMs,
    summary: cleanSummary(it.description) || undefined,
    imageUrl: it.imageUrl ?? null,
    notes,
  };
}

export default async function LatestPage(props: {
  searchParams: Promise<{ source?: string | string[]; lang?: string | string[]; sentiment?: string | string[]; page?: string | string[] }>;
}) {
  const params = await props.searchParams;
  const requestedSource = scalarPublicQuery(params.source)?.toLowerCase();
  const activeLang = pickEnum<NewsDataLanguageIso>(scalarPublicQuery(params.lang), LANGUAGE_ORDER);
  const activeSentiment = pickEnum<NewsDataSentiment>(scalarPublicQuery(params.sentiment), SENTIMENT_ORDER);
  const requestedPage = parsePage(scalarPublicQuery(params.page));

  const [wire, originalsRead] = await Promise.all([
    getAggregatedF1NewsResult({ limit: 120, revalidate: 300 }),
    getPublishedArticles(4)
      .then((articles) => ({ articles, unavailable: false }))
      .catch((error: unknown) => {
        if (error instanceof ArticleStorageUnavailable) return { articles: [], unavailable: true };
        throw error;
      }),
  ]);
  // A total outage is never cached as the page (ISR would keep it for the full
  // revalidate window): render it per request until a source answers (D2-RESILIENCE-4).
  if (wire.availability === 'unavailable') await outageConnection();
  const all = wire.items;
  const publishers = [...new Set([...REPORTED_PUBLISHERS, ...all.map((i) => i.source)])].map((name) => ({ slug: publisherSlug(name), label: name }));
  const source = publishers.find((p) => p.slug === requestedSource);
  const matchesSource = (i: RssItem) => i.source === source?.label;
  const sourceReport = source ? wire.sources.find((s) => s.source === source.label)?.state : undefined;

  // Only show a filter that matches at least one current story (no dead controls).
  const sentimentLabelled = SENTIMENT_ORDER.filter((s) => all.some((i) => i.sentiment === s));
  // A tone filter with a single value only splits the list in two; offer it once there is a real choice.
  const sentimentsPresent = sentimentLabelled.length >= 2 || activeSentiment ? sentimentLabelled : [];
  const langsPresent = LANGUAGE_ORDER.filter((iso) => iso === 'en' || all.some((i) => i.language === iso));
  const byLang = (i: RssItem) => (activeLang ? (i.language ? i.language === activeLang : activeLang === 'en') : true);
  const bySentiment = (i: RssItem) => (activeSentiment ? i.sentiment === activeSentiment : true);
  const pool = all.filter((i) => byLang(i) && bySentiment(i));
  const rawItems = source ? pool.filter(matchesSource) : pool;
  const filtered = Boolean(source || activeLang || activeSentiment);

  // Copy reflects what actually answered on this render, never a constant.
  const newsrooms = new Set(rawItems.map((i) => i.source)).size;

  // Composition: page 1 opens with the lead (newest story with a picture) and
  // the six newest others; the rest is the day-sectioned stream, paginated.
  // One story per syndicated article (Motorsport.com and Autosport often run one piece twice).
  const allStories = collapseSyndicated(pool.map(toStory));
  const carriedBy = (label: string) => (s: WireStory) => s.source === label || Boolean(s.alsoAt?.some((a) => a.source === label));
  // A publisher filter keeps every story that publisher ran, shown from its own copy.
  const stories = source ? collapseSyndicated(pool.map(toStory), source.label).filter(carriedBy(source.label)) : allStories;
  const leadIndex = Math.max(0, stories.findIndex((s) => s.imageUrl));
  const lead = stories[leadIndex];
  const afterLead = stories.filter((_, i) => i !== leadIndex);
  const recent = afterLead.slice(0, RECENT);
  const stream = afterLead.slice(RECENT);
  const { page, totalPages, slice } = paginate(stream, requestedPage, PER_PAGE, ORPHANS);
  const firstPage = page === 1;
  const now = renderTime();
  // One rhythm across the page's stories (spreads every fourth picture); the reader's days are drawn around them (DayStream).
  const layout = streamLayout(slice.map((s) => Boolean(s.imageUrl)));
  const entries: DayEntry[] = slice.map((story, i) => {
    const slot = layout[i]!;
    return {
      key: story.href,
      ms: story.publishedMs,
      wide: slot.slot === 'spread',
      node: slot.slot === 'spread' ? <WireSpread story={story} flip={slot.flip} /> : slot.slot === 'row' ? <WireRow story={story} /> : <WireTextRow story={story} />,
    };
  });
  const newest = stories.reduce((max, s) => Math.max(max, s.publishedMs || 0), 0);

  const sourceItems: FilterItem[] = [
    { href: buildHref({ language: activeLang, sentiment: activeSentiment }), label: 'All publishers', count: allStories.length, current: !source },
    ...publishers
      // Counted after syndicated copies are folded: the number is what the filter shows.
      .map((p) => ({ ...p, count: allStories.filter(carriedBy(p.label)).length }))
      .filter((p) => p.count > 0 || p.slug === source?.slug)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .map((p) => ({
        href: buildHref({ source: p.slug, language: activeLang, sentiment: activeSentiment }),
        label: p.label,
        count: p.count,
        current: source?.slug === p.slug,
      })),
  ];
  const languageItems: FilterItem[] = [
    { href: buildHref({ source: source?.slug, sentiment: activeSentiment }), label: 'All languages', current: !activeLang },
    ...langsPresent.map((iso) => ({ href: buildHref({ source: source?.slug, language: iso, sentiment: activeSentiment }), label: LANGUAGE_LABEL[iso], current: activeLang === iso })),
  ];
  const sentimentItems: FilterItem[] = [
    { href: buildHref({ source: source?.slug, language: activeLang }), label: 'Any tone', current: !activeSentiment },
    ...sentimentsPresent.map((s) => ({ href: buildHref({ source: source?.slug, language: activeLang, sentiment: s }), label: SENTIMENT_LABEL[s], current: activeSentiment === s })),
  ];

  return (
    <div className={`bc relative ${stickyRailScrollMargin}`} data-page="latest">
      <Masthead
        kicker={<>Paddock wire{stories.length > 0 && <> · {plural(stories.length, 'story', 'stories')} · {plural(newsrooms, 'newsroom')}</>}</>}
        title="Latest"
      >
        <p className="max-w-[40ch] text-[clamp(1.02rem,0.95rem+0.3vw,1.18rem)] leading-relaxed text-[color:var(--bc-silver)]">
          Every Formula 1 story worth reading from the newsrooms that cover the sport, newest first. Each one opens in full at its publisher.
        </p>
        {newest > 0 && (
          <p className="mt-4 flex items-center gap-3 text-[0.85rem] text-[color:var(--bc-titanium)]">
            <span className="bc-label text-[color:var(--bc-silver)]">Newest story</span>
            <RelativeTime ms={newest} className="bc-mono text-[color:var(--bc-white)]" />
          </p>
        )}
      </Masthead>

      {/* Filters: shareable links, sticky under the header on wide screens. They wrap, never scroll sideways. */}
      {all.length > 0 && (
        <StickyRail>
          <div className="ds-container flex flex-col">
            <FilterRail label="Filter by publisher" title="Publisher" items={sourceItems} />
            {(langsPresent.length > 1 || sentimentsPresent.length > 0) && (
              <div className="flex min-w-0 flex-col border-t border-white/[0.06] md:flex-row md:gap-10">
                {langsPresent.length > 1 && <FilterRail label="Filter by language" title="Language" items={languageItems} className="min-w-0 md:flex-1" />}
                {sentimentsPresent.length > 0 && <FilterRail label="Filter by tone" title="Tone" items={sentimentItems} className="min-w-0 md:flex-1" />}
              </div>
            )}
          </div>
        </StickyRail>
      )}

      {wire.availability === 'partial' && (
        <div className="ds-container mt-8">
          <CarbonNotice tone="unavailable" title="A few stories may be missing">
            Some newsrooms can’t be reached right now. Everything else is here, newest first.
          </CarbonNotice>
        </div>
      )}

      {stories.length === 0 ? (
        <div className="ds-container py-[clamp(3rem,8vw,7rem)]">
          {wire.availability === 'unavailable' ? (
            <CarbonNotice tone="unavailable" title="Headlines unavailable" action={{ label: 'Try again', href: buildHref({ source: source?.slug, language: activeLang, sentiment: activeSentiment }) }}>
              The latest headlines can’t be shown right now. Please check back in a few minutes.
            </CarbonNotice>
          ) : filtered ? (
            <CarbonNotice title={source ? `No stories from ${source.label} right now` : 'No stories match these filters'} action={{ label: 'Show every publisher', href: '/latest' }}>
              {source ? sourceEmptyReason(source.label, sourceReport) : 'Nothing matches these filters right now. Try a different combination.'}
            </CarbonNotice>
          ) : (
            <CarbonNotice title="No new stories yet" action={{ label: 'Refresh', href: '/latest' }}>
              There are no new Formula 1 stories right now. Check back shortly.
            </CarbonNotice>
          )}
        </div>
      ) : (
        <>
          {firstPage && lead && (
            <section aria-labelledby="top-story-title" className="pt-10 md:pt-14">
              <div className="ds-container">
                <h2 id="top-story-title" className="sr-only">Lead story and the wire</h2>
                <WireLead story={lead} headingLevel={3} />
                {recent.length > 0 && (
                  <div className="mt-14 grid gap-x-10 gap-y-6 border-t border-white/[0.16] pt-8 lg:mt-20 lg:grid-cols-12">
                    <div className="lg:col-span-3">
                      <Kicker as="h3" id="recent-title">The wire</Kicker>
                      <p className="mt-3 max-w-[30ch] text-[0.92rem] leading-relaxed text-[color:var(--bc-titanium)]">The newest stories as they land, in your time.</p>
                    </div>
                    <WireTimeline stories={recent} headingLevel={4} className="lg:col-span-9 lg:columns-2 lg:gap-x-10" />
                  </div>
                )}
              </div>
            </section>
          )}

          {firstPage && originalsRead.articles.length > 0 && (
            <OriginalsBand articles={originalsRead.articles} unavailable={originalsRead.unavailable} />
          )}

          <DayStream entries={entries} serverNow={now} />

          <div className="ds-container pt-14">
            <Pager page={page} totalPages={totalPages} hrefFor={(p) => buildHref({ source: source?.slug, language: activeLang, sentiment: activeSentiment, page: p })} />
          </div>
        </>
      )}

      <div aria-hidden className="pb-[clamp(4rem,8vw,7rem)]" />
    </div>
  );
}
