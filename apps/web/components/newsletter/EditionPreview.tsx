import { getF1NewsFeed } from '@apex/api-client/rss';
import { Container, Grid, Heading, Label, SourceNote, Text, Unavailable } from '@/components/ds';
import { cleanHeadline, cleanSummary, collapseSyndicated, utcStamp } from '@/components/news/news-format';
import { getCalendar, getDriverStandings, getStandingsSeason } from '@/lib/grid';
import { nextBriefing } from './newsletter-copy';
import { Countdown } from '@/components/brand-c/live';

/**
 * "What an edition contains", proven with today's data: the next race, up to
 * eight current headlines and the top five, read from the same providers the
 * sending job uses (Jolpica calendar and standings, the F1-only news feed).
 * It is labelled a preview; the real edition is assembled when it is sent.
 */
export async function EditionPreview() {
  const [calendar, feed, standings, standingsSeason] = await Promise.all([
    getCalendar(),
    getF1NewsFeed({ limit: 24, revalidate: 300 }).catch(() => []),
    getDriverStandings().catch(() => []),
    getStandingsSeason().catch(() => null),
  ]);
  const briefing = calendar.state === 'available' ? nextBriefing(calendar.now, calendar.races) : null;
  const race = briefing?.race ?? calendar.next;
  // One line per story: syndicated copies (Motorsport.com and Autosport run one article twice) are folded together.
  const headlines = collapseSyndicated(
    feed
      .filter((item) => /^https:\/\//.test(item.link))
      .map((item) => ({ title: cleanHeadline(item.title, item.source), href: item.link, source: item.source, publishedMs: item.pubDateMs, summary: cleanSummary(item.description) || undefined })),
  ).slice(0, 8);
  const top5 = standings.slice(0, 5);
  const raceStart = race ? Date.parse(race.raceStartIso) : NaN;

  return (
    <section aria-labelledby="edition-title" className="py-[var(--space-section)]">
      <Container>
        <Grid className="gap-y-10">
          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Heading level={2} id="edition-title" size="display-m">What lands in your inbox</Heading>
            <Text size="body" tone="muted" className="mt-5 max-w-[40ch]">
              Three things, nothing else: the next race and its start time, up to eight current Formula&nbsp;1 headlines with links to their publishers, and the top five of the drivers’ championship.
            </Text>
            <div className="mt-8 shadow-[inset_0_1px_0_var(--rule-strong)]">
              <Label as="p" className="block pt-4">Next edition</Label>
              {briefing ? (
                <>
                  <p className="mt-3">
                    <Countdown iso={new Date(briefing.sendAt).toISOString()} size="m" rolling={false} />
                  </p>
                  <p className="mt-2 font-text text-body text-fg">
                    {utcStamp(briefing.sendAt)}, for the {briefing.race.name}.
                  </p>
                </>
              ) : calendar.state === 'unavailable' ? (
                <p className="mt-2 font-text text-body text-fg-2">Not available right now. Please check back in a few minutes.</p>
              ) : (
                <p className="mt-2 font-text text-body text-fg-2">None scheduled: no race is left on this season&rsquo;s calendar. Editions return with the next season.</p>
              )}
            </div>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <figure className="tone-paper overflow-hidden rounded-[22px] shadow-[0_50px_120px_-50px_rgb(233_240_255/0.35)]">
              <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 bg-tone-raised px-5 py-3 md:px-8">
                <span className="font-text text-small font-[650] text-fg">Preview with today’s news</span>
                <span className="font-text text-caption text-fg-2">Your edition carries the latest on the morning it is sent</span>
              </figcaption>
              <div className="px-5 py-8 md:px-10 md:py-12">
                <dl className="grid gap-y-1 pb-6 font-text text-small shadow-[inset_0_-1px_0_var(--rule)] sm:grid-cols-[5.5rem_minmax(0,1fr)]">
                  <dt className="text-fg-3">From</dt>
                  <dd className="text-fg">Apex · Race Week</dd>
                  <dt className="mt-2 text-fg-3 sm:mt-0">Subject</dt>
                  <dd className="font-[650] text-fg">Race Week · {race ? race.name : 'Race Week Briefing'} · the briefing before lights out</dd>
                </dl>

                <div className="pt-8">
                  <Label as="h3" className="block">Next race</Label>
                  {race && Number.isFinite(raceStart) ? (
                    <>
                      <Heading level={4} as="p" size="display-m" className="mt-3">{race.name}</Heading>
                      <p className="mt-3 font-text text-body text-fg-2">{race.circuitName}, {race.city}, {race.country} · race start {utcStamp(raceStart)}</p>
                    </>
                  ) : (
                    <Unavailable compact className="mt-3" title="Next race unavailable">The next race can’t be shown right now.</Unavailable>
                  )}
                </div>

                <div className="pt-10">
                  <Label as="h3" className="block">Headlines</Label>
                  {headlines.length ? (
                    <ol className="mt-3">
                      {headlines.map((h) => (
                        <li key={h.href} className="shadow-[inset_0_-1px_0_var(--rule)]">
                          <a href={h.href} target="_blank" rel="noopener noreferrer" className="group block py-3.5">
                            <span className="block font-text text-caption font-[650] text-fg-3">{h.source}</span>
                            <span className="mt-1 block font-text text-heading-s text-fg group-hover:text-accent">{h.title}</span>
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Unavailable compact className="mt-3" title="Headlines unavailable">The latest headlines can’t be shown right now.</Unavailable>
                  )}
                </div>

                <div className="pt-10">
                  <Label as="h3" className="block">Drivers’ championship, top five</Label>
                  {top5.length ? (
                    <table className="mt-3 w-full max-w-[40rem] border-collapse font-text text-small">
                      <caption className="sr-only">Drivers’ championship top five{standingsSeason?.season ? `, ${standingsSeason.season}` : ''}{standingsSeason?.round ? ` after round ${standingsSeason.round}` : ''}</caption>
                      <thead>
                        <tr className="shadow-[inset_0_-1px_0_var(--rule-strong)]">
                          <th scope="col" className="w-12 py-2 text-left font-text text-label uppercase text-fg-3">Pos</th>
                          <th scope="col" className="py-2 text-left font-text text-label uppercase text-fg-3">Driver</th>
                          <th scope="col" className="hidden py-2 text-left font-text text-label uppercase text-fg-3 sm:table-cell">Team</th>
                          <th scope="col" className="py-2 text-right font-text text-label uppercase text-fg-3">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {top5.map((row) => (
                          <tr key={row.driver.slug} className="shadow-[inset_0_-1px_0_var(--rule)]">
                            <td className="py-2.5 tabular-nums text-fg-2">{row.position}</td>
                            <th scope="row" className="py-2.5 text-left font-[650] text-fg">{row.driver.fullName}</th>
                            <td className="hidden py-2.5 text-fg-2 sm:table-cell">{row.constructorName}</td>
                            <td className="py-2.5 text-right font-[650] tabular-nums text-fg">{row.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Unavailable compact className="mt-3" title="Standings unavailable">The standings can’t be shown right now.</Unavailable>
                  )}
                  {top5.length > 0 && standingsSeason?.season && (
                    <SourceNote className="mt-3" updated={`${standingsSeason.season} season${standingsSeason.round ? `, after round ${standingsSeason.round}` : ''}`} />
                  )}
                </div>
              </div>
            </figure>
          </div>
        </Grid>
      </Container>
    </section>
  );
}

/** Same shape as the preview while it loads. */
export function EditionPreviewSkeleton() {
  return (
    <section aria-busy="true" className="py-[var(--space-section)]">
      <Container>
        <Grid className="gap-y-10">
          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <span className="ds-skeleton block h-24 w-full" />
            <span className="ds-skeleton mt-5 block h-28 w-full" />
          </div>
          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <span role="status" aria-label="Loading the edition preview" className="ds-skeleton block h-[44rem] w-full" />
          </div>
        </Grid>
      </Container>
    </section>
  );
}
