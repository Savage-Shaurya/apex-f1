import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Container, Heading, Text } from '@/components/ds';
import { LegalIndex } from './LegalIndex';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const DOCS = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/disclaimer', label: 'Disclaimer' },
  { href: '/legal/dmca', label: 'Copyright' },
];

const LONG_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * A calm reading layout for legal text: the document switch, a display-m
 * title, the last-updated date in words, a 68ch column of prose with
 * heading-m sections, and a side index on desktop (a disclosure on phones).
 */
export function LegalDocument({ title, current, updated, intro, sections }: { title: string; current: string; updated: string; intro?: ReactNode; sections: LegalSection[] }) {
  const date = Number.isFinite(Date.parse(updated)) ? LONG_DATE.format(new Date(updated)) : updated;
  return (
    <article className="bc bcp relative isolate overflow-x-clip [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28 [&_select]:scroll-mt-28">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh]" />
      <Container className="pt-10 md:pt-16">
        <nav aria-label="Legal documents">
          <ul className="flex flex-wrap gap-x-6 gap-y-1 shadow-[inset_0_-1px_0_var(--rule)]">
            {DOCS.map((d) => (
              <li key={d.href}>
                <Link
                  href={d.href}
                  aria-current={d.href === current ? 'page' : undefined}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center font-text text-ui font-[650] text-fg-2 transition-colors hover:text-fg aria-[current=page]:text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-brand-red after:transition-transform after:duration-[var(--duration-slow)] hover:after:scale-x-100 aria-[current=page]:after:scale-x-100"
                >
                  {d.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <Container className="py-[var(--space-block)] pb-[var(--space-section)]">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,var(--measure))] xl:grid-cols-[minmax(0,17rem)_minmax(0,var(--measure))]">
          <header className="min-w-0 lg:col-start-2">
            <Heading level={1} size="display-m">{title}</Heading>
            <p className="mt-4 font-text text-small text-fg-3">
              Last updated <time dateTime={updated} className="text-fg-2">{date}</time>
            </p>
          </header>

          {/* A plain wrapper: LegalIndex is itself the "On this page" nav, so no nested complementary landmark. */}
          <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:pt-2">
            <LegalIndex items={sections.map((s) => ({ id: s.id, label: s.title }))} />
          </div>

          <div className="legal-prose min-w-0 lg:col-start-2">
            {intro && (
              <div className="font-editorial text-lead text-fg [&_p+p]:mt-4">{intro}</div>
            )}
            {sections.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-12 scroll-mt-[calc(var(--nav-offset)+1.5rem)] pt-8 shadow-[inset_0_1px_0_var(--rule)] first:mt-10">
                <Heading level={2} size="heading-m" id={`${s.id}-h`}>{s.title}</Heading>
                <div className="mt-4 font-text text-body text-fg-2 [&_a]:text-fg [&_a]:underline [&_a]:decoration-[var(--rule-strong)] [&_a]:underline-offset-[0.18em] [&_a]:[overflow-wrap:anywhere] [&_a:hover]:text-accent [&_li]:pl-1 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p+p]:mt-4 [&_strong]:font-[650] [&_strong]:text-fg [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_li]:marker:text-fg-3">
                  {s.body}
                </div>
              </section>
            ))}
            <Text size="small" tone="subtle" className="mt-14 pt-6 shadow-[inset_0_1px_0_var(--rule)]">
              Last updated {date}. Questions about this document: <Link href="/contact" className="text-fg underline decoration-[var(--rule-strong)] underline-offset-[0.18em] hover:text-accent">contact Apex</Link>.
            </Text>
          </div>
        </div>
      </Container>
    </article>
  );
}
