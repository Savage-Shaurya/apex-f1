import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import type { Metadata } from 'next';
import { ArrowLink, ButtonLink, Grid, Heading, Label, Section, Stat, StatGroup, Text } from '@/components/ds';
import { SOCIAL_LINKS } from '@/components/ds/shell/social';
import { Rise } from '../support/_components/Rise';
import { SectionTitle } from '@/components/info/carbon';
import { getSeasonContext } from '@/lib/season';
import { getCalendar, getDriverStandings } from '@/lib/grid';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'About Apex: an independent, fan-built Formula 1 platform',
  description:
    'Apex is an independent, fan-built Formula 1 platform made by one person, Shaurya Punj: the calendar, results, the championship archive back to 1950, final session timing and the latest news, in one place.',
  alternates: { canonical: '/about' },
});

const CREATOR = {
  name: 'Shaurya Punj',
  role: 'AI/ML and agentic software engineer',
  location: 'India',
  links: [
    { label: 'Portfolio', href: 'https://shauryapunj.com' },
    ...SOCIAL_LINKS.map((l) => ({ label: l.id === 'email' ? l.handle : l.label, href: l.href })),
  ],
} as const;

const PRINCIPLES = [
  {
    title: 'Real or nothing',
    body: 'Every result, time, name and photo on Apex is real. If something has not happened yet or cannot be shown right now, the page says so plainly instead of guessing.',
  },
  {
    title: 'Made to be read',
    body: 'Clear pages, comfortable type and motion that settles things into place, never in the way of what you came for.',
  },
  {
    title: 'Independent',
    body: 'No team money, no licensing deals, no behavioural ads. Headlines take you to the newsroom that wrote them, and videos play from their own channels.',
  },
];

export default async function AboutPage() {
  const [season, calendar, standings] = await Promise.all([
    getSeasonContext().catch(() => null),
    getCalendar().catch(() => null),
    getDriverStandings().catch(() => []),
  ]);
  const active = season?.activeSeason ?? null;
  const races = calendar && calendar.state === 'available' ? calendar.races.length : null;
  const done = calendar && calendar.state === 'available' ? calendar.races.filter((r) => Date.parse(r.raceStartIso) < calendar.now).length : null;

  return (
    <article className="bc bcp relative isolate overflow-x-clip [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28 [&_select]:scroll-mt-28">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh]" />
      <Section spacing="loose" aria-labelledby="about-title">
        <Grid className="gap-y-10">
          <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-8">
            <Heading level={1} size="display-l" id="about-title">About Apex</Heading>
            <Text editorial size="lead" className="mt-8 max-w-[34ch] text-[clamp(1.375rem,1.1rem+1.2vw,2rem)] leading-[1.38]">
              Apex is an independent Formula 1 platform, made by one person for everyone who loves the sport.
            </Text>
          </div>
          <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-4 lg:self-end">
            <Text tone="muted">
              The calendar, results, the full championship archive, final timing from every session and the latest Formula 1 news,
              together in one place.
            </Text>
          </div>
        </Grid>

        <StatGroup className="mt-16 shadow-[inset_0_1px_0_var(--rule)] pt-10">
          {active && <Stat label="Seasons in the archive" value={active - 1949} note={`1950 to ${active}`} />}
          {races !== null && <Stat label={`Rounds in ${calendar!.season}`} value={races} note={done !== null ? `${done} run so far` : undefined} />}
          {standings.length > 0 && <Stat label="Drivers classified" value={standings.length} note={active ? `${active} championship` : undefined} />}
          <Stat label="People behind it" value="1" note="No team, no agency" />
        </StatGroup>
      </Section>

      <Section spacing="default" aria-labelledby="principles-title">
        <Heading level={2} size="display-m" id="principles-title">What Apex stands for</Heading>
        <Rise as="div" className="mt-12 grid gap-x-10 gap-y-12 md:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} data-rise className="min-w-0 pt-6 shadow-[inset_0_2px_0_var(--rule-strong)]">
              <Heading level={3} size="heading-l">{p.title}</Heading>
              <Text tone="muted" className="mt-4">{p.body}</Text>
            </div>
          ))}
        </Rise>
      </Section>

      <Section tone="raised" spacing="default" aria-labelledby="maker-title">
        <Grid className="gap-y-10">
          <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-7">
            <Label as="p" size="l">Built by</Label>
            <Heading level={2} size="display-m" id="maker-title" className="mt-4">{CREATOR.name}</Heading>
            <p className="mt-3 font-text text-heading-s text-fg-2">{CREATOR.role}, {CREATOR.location}</p>
            <Text className="mt-6" measure>
              Apex is designed, built and looked after by one person. No team, no agency, no outside investors. If you spot a wrong
              result or something that does not work, it lands in one inbox, and it gets read.
            </Text>
          </div>
          <ul className="col-span-4 min-w-0 self-end sm:col-span-8 lg:col-span-4 lg:col-start-9">
            {CREATOR.links.map((l) => (
              <li key={l.href} className="shadow-[inset_0_-1px_0_var(--rule)]">
                <ArrowLink href={l.href} external className="w-full justify-between py-2">{l.label}</ArrowLink>
              </li>
            ))}
          </ul>
        </Grid>
      </Section>

      <Section spacing="default" aria-labelledby="next-title" className="bc-carbon border-t border-[color:var(--bc-rule)]">
        <div className="grid items-end gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <SectionTitle id="next-title" size="s" eyebrow="With thanks" title="Credits and the fine print">
              Every source, photographer, newsroom and open-source maker Apex relies on is credited, with their licences, on one page.
            </SectionTitle>
          </div>
          <div className="flex min-w-0 flex-wrap gap-3 lg:col-span-5 lg:justify-end">
            <ButtonLink href="/references" variant="primary">References</ButtonLink>
            <ButtonLink href="/contact" variant="secondary">Contact</ButtonLink>
            <ButtonLink href="/support" variant="secondary">Give back</ButtonLink>
          </div>
        </div>
      </Section>
    </article>
  );
}
