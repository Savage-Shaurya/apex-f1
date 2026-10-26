import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import type { Metadata } from 'next';
import { ArrowLink, Grid, Heading, Icon, Label, Section, Text, TextLink } from '@/components/ds';
import { CopyAddress } from './_components/CopyAddress';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'Contact Apex',
  description: 'Contact Apex: corrections and tips, collaboration, copyright notices and security reports. One person, one inbox.',
  alternates: { canonical: '/contact' },
});

/** Apex is run by one person, so there is one real inbox. Topics only pre-fill the subject line. */
const INBOX = 'shaurya@snappycrew.com';

const TOPICS = [
  {
    title: 'Corrections and feedback',
    subject: 'Apex · Correction',
    body: 'Spotted a wrong result, a missing driver or a broken page, or have an idea that would make Apex better?',
    include: 'Include the page address and what you expected to see.',
  },
  {
    title: 'Collaboration',
    subject: 'Apex · Collaboration',
    body: 'Ideas for working together on something Formula 1. Apex does not sell team advertising or sponsorship.',
    include: 'A few lines on the idea is enough to start.',
  },
  {
    title: 'Copyright and takedowns',
    subject: 'Apex · Copyright notice',
    body: 'Rights questions about an image, a headline or a video shown on Apex.',
    include: 'Follow the notice checklist on the copyright page so the request can be handled quickly.',
    link: { href: '/legal/dmca', label: 'Copyright notice checklist' },
  },
  {
    title: 'Security',
    subject: 'Apex · Security report',
    body: 'Found a vulnerability? Describe it privately by email, and please do not disclose it publicly until it is fixed.',
    include: 'Steps to reproduce help most. Never include anyone’s personal data.',
  },
];

export default function ContactPage() {
  return (
    <article className="bc bcp relative isolate overflow-x-clip [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28 [&_select]:scroll-mt-28">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh]" />
      <Section spacing="loose" aria-labelledby="contact-title">
        <Grid className="gap-y-14">
          <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-5">
            <div className="lg:sticky lg:top-[calc(var(--nav-offset)+2rem)]">
              <Heading level={1} size="display-l" id="contact-title">Contact</Heading>
              <Text editorial size="lead" className="mt-8 max-w-[30ch]">
                Apex is built and run by one person, so every message lands in the same inbox.
              </Text>
              <div className="mt-10">
                <Label as="p">The inbox</Label>
                <p className="mt-2 font-text text-heading-s text-fg [overflow-wrap:anywhere]">
                  <TextLink href={`mailto:${INBOX}`}>{INBOX}</TextLink>
                </p>
                <div className="mt-4"><CopyAddress address={INBOX} /></div>
              </div>
              <Text size="small" tone="subtle" className="mt-8 max-w-[40ch]">
                Each topic opens your email app with the subject filled in.
              </Text>
            </div>
          </div>

          <div className="col-span-4 min-w-0 sm:col-span-8 lg:col-span-7">
            <Heading level={2} size="heading-l">Pick a topic</Heading>
            <ul className="mt-6 shadow-[inset_0_1px_0_var(--rule)]">
              {TOPICS.map((t) => (
                <li key={t.subject} className="group relative py-8 shadow-[inset_0_-1px_0_var(--rule)] md:py-10">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <h3 className="font-text text-heading-l text-fg">
                        <a
                          href={`mailto:${INBOX}?subject=${encodeURIComponent(t.subject)}`}
                          className="transition-colors duration-[var(--duration-base)] after:absolute after:inset-0 group-hover:text-accent focus-visible:outline-none [&:focus-visible]:underline"
                        >
                          {t.title}
                          <span className="sr-only"> (opens your email app, subject “{t.subject}”)</span>
                        </a>
                      </h3>
                      <Text className="mt-4 max-w-[52ch]" tone="muted">{t.body}</Text>
                      <Text size="small" tone="subtle" className="mt-2 max-w-[52ch]">{t.include}</Text>
                    </div>
                    <Icon name="arrow-up-right" size={28} className="mt-2 shrink-0 text-accent transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  </div>
                  {t.link && (
                    <div className="relative z-[1] mt-3">
                      <ArrowLink href={t.link.href}>{t.link.label}</ArrowLink>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <ArrowLink href="/newsletter">Or get the race-week newsletter</ArrowLink>
            </div>
          </div>
        </Grid>
      </Section>
    </article>
  );
}
