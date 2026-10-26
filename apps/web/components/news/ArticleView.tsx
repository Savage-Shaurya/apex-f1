import '@/components/brand-c/brand-c.css';
import type { ApexArticle, ApexArticleSummary } from '@apex/db';
import { ArrowLink, Breadcrumbs, Card, Container, Grid, Heading, Label, Media, SourceNote, Tag, Text } from '@/components/ds';
import { ArticleBody } from './ArticleBody';
import { OriginalCard } from './OriginalCard';
import { WireList, type WireStory } from './WireStories';
import { citedSources, utcLongDate, utcStamp, wordCount } from './news-format';

/** Capital display titles stay short (ds 4.4); longer titles are set in sentence case. */
export const CAPS_TITLE_LIMIT = 32;

function toMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * An Apex Original, Race Lab hierarchy: trail, topic, title, byline facts,
 * the hero picture whole (chamfered, the one per view), the standfirst in
 * the editorial serif, then the body at the reading measure beside a Facts
 * rail that lists only what can be checked (dates, length, the sources the
 * story itself links to). Reading position shows in the header's progress line.
 */
export function ArticleView({ a, moreOriginals, wire }: { a: ApexArticle; moreOriginals: ApexArticleSummary[]; wire: WireStory[] }) {
  const published = toMs(a.publishedAt);
  const updated = toMs(a.updatedAt);
  const words = wordCount(a.bodyMd);
  const sources = citedSources(a.bodyMd);
  const caps = a.title.length <= CAPS_TITLE_LIMIT;
  const showUpdated = updated > 0 && published > 0 && updated - published > 3_600_000;

  return (
    <article className="bc tone-carbon">
      <header>
        <Container className="pt-6 md:pt-8">
          <Breadcrumbs items={[{ label: 'Latest', href: '/latest' }, { label: 'Story' }]} />
          <div className="mt-8 max-w-[72rem] md:mt-12">
            <div className="flex flex-wrap items-center gap-3">
              <Tag variant="outline">Apex Original</Tag>
              {a.section && <Tag>{a.section}</Tag>}
            </div>
            <Heading level={1} size="display-l" caps={caps} className="mt-5">{a.title}</Heading>
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-text text-small text-fg-2">
            {published > 0 && <time dateTime={new Date(published).toISOString()}>{utcLongDate(published)}</time>}
            {a.readTimeMinutes ? <><span aria-hidden>·</span><span>{a.readTimeMinutes} min read</span></> : null}
            <span aria-hidden>·</span>
            <span>Written by Apex</span>
          </p>
        </Container>
        {a.heroImageUrl && (
          <Container className="mt-10 md:mt-14">
            {/* Capped so the whole 16:9 picture fits in about three quarters of the screen height. */}
            <Media src={a.heroImageUrl} alt="" kind="wide" chamfer priority sizes="(max-width: 1680px) 100vw, 1600px" className="max-w-[calc(72svh*16/9)]" />
          </Container>
        )}
      </header>

      <Container className="pb-[var(--space-section)] pt-10 md:pt-14">
        <Grid className="gap-y-14">
          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <div className="max-w-[var(--measure)]">
              {a.dek && <Text editorial size="lead" className="mb-10">{a.dek}</Text>}
              <div id="article-body">
                {a.bodyMd?.trim()
                  ? <ArticleBody markdown={a.bodyMd} />
                  : <Text tone="muted">This story has no body text yet.</Text>}
              </div>
              <div className="mt-16 flex flex-wrap items-center justify-between gap-4 pt-6 shadow-[inset_0_1px_0_var(--rule)]">
                                <ArrowLink href="/latest">Back to the latest news</ArrowLink>
              </div>
            </div>
          </div>

          <section aria-labelledby="facts-title" className="col-span-4 md:col-span-8 lg:col-span-4">
            <div className="lg:sticky lg:top-[calc(var(--nav-offset)+1.5rem)] lg:transition-[top] lg:duration-[var(--duration-slow)]">
              <Card as="section">
                <Label as="h2" id="facts-title" className="block">Facts</Label>
                <dl className="mt-4">
                  {published > 0 && (
                    <div className="flex items-baseline justify-between gap-4 py-2.5 shadow-[inset_0_-1px_0_var(--rule)]">
                      <dt className="font-text text-small text-fg-2">Published</dt>
                      <dd className="text-right font-text text-small font-[650] text-fg">{utcLongDate(published)}</dd>
                    </div>
                  )}
                  {showUpdated && (
                    <div className="flex items-baseline justify-between gap-4 py-2.5 shadow-[inset_0_-1px_0_var(--rule)]">
                      <dt className="font-text text-small text-fg-2">Updated</dt>
                      <dd className="text-right font-text text-small font-[650] text-fg">{utcStamp(updated)}</dd>
                    </div>
                  )}
                  {a.section && (
                    <div className="flex items-baseline justify-between gap-4 py-2.5 shadow-[inset_0_-1px_0_var(--rule)]">
                      <dt className="font-text text-small text-fg-2">Section</dt>
                      <dd className="text-right font-text text-small font-[650] text-fg">{a.section}</dd>
                    </div>
                  )}
                  {words > 0 && (
                    <div className="flex items-baseline justify-between gap-4 py-2.5 shadow-[inset_0_-1px_0_var(--rule)]">
                      <dt className="font-text text-small text-fg-2">Length</dt>
                      <dd className="text-right font-text text-small font-[650] tabular-nums text-fg">{words.toLocaleString('en-GB')} words</dd>
                    </div>
                  )}
                </dl>
                {sources.length > 0 && (
                  <div className="mt-6">
                    <Label as="h3" className="block">Sources cited</Label>
                    <ul className="mt-2">
                      {sources.slice(0, 8).map((s) => (
                        <li key={s.href} className="shadow-[inset_0_-1px_0_var(--rule)]">
                          <a href={s.href} target="_blank" rel="noopener noreferrer" className="group/src flex min-h-11 items-center justify-between gap-3 py-2 font-text text-small text-fg hover:text-accent">
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              {s.label}
                              <span className="block text-caption text-fg-3">{s.host}</span>
                            </span>
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
              <SourceNote className="mt-3" updated={showUpdated ? `Last updated ${utcStamp(updated)}` : undefined} />
            </div>
          </section>
        </Grid>
      </Container>

      {(moreOriginals.length > 0 || wire.length > 0) && (
        <section aria-labelledby="keep-reading" className="tone-raised py-[var(--space-section)]">
          <Container>
            <Heading level={2} id="keep-reading" size="display-m">Keep reading</Heading>
            <Grid className="mt-10 gap-y-12">
              {moreOriginals.length > 0 && (
                <div className={wire.length ? 'col-span-4 md:col-span-8 lg:col-span-8' : 'col-span-4 md:col-span-8 lg:col-span-12'}>
                  <div className="grid gap-x-[var(--gutter)] gap-y-10 md:grid-cols-2">
                    {moreOriginals.map((o) => <OriginalCard key={o.slug} a={o} />)}
                  </div>
                </div>
              )}
              {wire.length > 0 && (
                <div className={moreOriginals.length ? 'col-span-4 md:col-span-8 lg:col-span-4' : 'col-span-4 md:col-span-8 lg:col-span-6'}>
                  <Label as="h3" className="block pb-3">Latest news</Label>
                  <WireList stories={wire} headingLevel={4} />
                </div>
              )}
            </Grid>
          </Container>
        </section>
      )}
    </article>
  );
}
