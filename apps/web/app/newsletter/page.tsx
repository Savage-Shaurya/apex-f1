import type { Metadata } from 'next';
import { Suspense } from 'react';
import '@/components/brand-c/brand-c.css';
import { CarbonNotice, Kicker } from '@/components/news/carbon';
import { NewsletterForm } from '@/components/newsletter/NewsletterForm';
import { EditionPreview, EditionPreviewSkeleton } from '@/components/newsletter/EditionPreview';
import { withSocial } from '@/lib/page-metadata';

export const revalidate = 300;

export const metadata: Metadata = withSocial({
  title: 'Race week briefing',
  description: 'One short email the Friday before each Formula 1 race: the next race and its start time, up to eight current headlines, and the top five drivers.',
  alternates: { canonical: '/newsletter' },
});

export default function NewsletterPage() {
  return (
    <div className="bc tone-carbon relative" data-page="newsletter">
      {/* The one ask on the page, under warm red light rising from below (the Give back light of the home page). */}
      <header className="relative isolate overflow-hidden border-b border-white/[0.08]">
        <div aria-hidden className="absolute inset-0 -z-10">
          <div className="bc-flood-static absolute inset-0" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_60%_at_80%_110%,rgb(225_6_0/0.22),transparent_70%)]" />
        </div>
        <div className="ds-container grid items-end gap-x-12 gap-y-12 pb-[clamp(3rem,7vw,6rem)] pt-[clamp(2.5rem,6vw,5.5rem)] lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <Kicker className="bc-in-up">Race week briefing · Fridays before each race</Kicker>
            {/* The gap lives on a wrapper: .bc-mask sets its own negative margins (glyph room), which beat a margin utility on the h1. */}
            <div className="mt-5">
              <h1 className="bc-display bc-mask text-[clamp(2.6rem,8vw,6.6rem)]"><span className="bc-in-rise">Race week</span></h1>
            </div>
            <p className="mt-6 max-w-[42ch] text-[clamp(1.05rem,0.98rem+0.35vw,1.25rem)] leading-relaxed text-[color:var(--bc-silver)]">
              One short email the Friday before each race: when the lights go out, the latest headlines and who leads the championship. No race that week, no email.
            </p>
          </div>
          <div className="min-w-0 rounded-[22px] bg-[color:var(--bc-carbon)] p-6 ring-1 ring-white/10 md:p-8 lg:col-span-5">
            <NewsletterForm buttonVariant="primary" />
          </div>
        </div>
      </header>

      <Suspense fallback={<EditionPreviewSkeleton />}>
        <EditionPreview />
      </Suspense>

      <section aria-labelledby="archive-title" className="pb-[clamp(4rem,8vw,7rem)]">
        <div className="ds-container grid gap-x-10 gap-y-6 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Kicker as="h2" id="archive-title">Past editions</Kicker>
          </div>
          <div className="lg:col-span-8">
            <CarbonNotice title="No archive yet" headingLevel={3}>
              Past editions are not kept online. The preview above shows what the next one will hold.
            </CarbonNotice>
          </div>
        </div>
      </section>
    </div>
  );
}
