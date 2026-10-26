import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import { Eyebrow, SectionTitle, fitDisplay } from '@/components/info/carbon';
import { loadPhotoCredits, type PhotoCredit } from '@/components/info/photo-credits';
import { BRAND_STATEMENT, NON_AFFILIATION_STATEMENT, REFERENCE_GROUPS, TRADEMARK_NOTICE, type Credit } from '@/lib/credits';

// Photo credits follow the pages' own Commons lookups (cached for a day).
export const revalidate = 86_400;

export const metadata: Metadata = {
  title: 'References',
  description: `${BRAND_STATEMENT} The data, images, photographs, newsrooms, open-source software and typefaces it is built on, with their licences.`,
  alternates: { canonical: '/references' },
};

const LINK = 'underline decoration-[color:var(--bc-rule-strong)] underline-offset-[0.22em] transition-colors hover:decoration-[color:var(--bc-red-text)]';

function CreditRow({ credit }: { credit: Credit }) {
  return (
    <li className="grid gap-x-10 gap-y-2 border-b border-[color:var(--bc-rule)] py-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-baseline lg:grid-cols-1 xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <p className="bc-wide text-[1.05rem] leading-[1.2] text-white [overflow-wrap:anywhere]">{credit.name}</p>
      <p className="max-w-[52ch] text-[1rem] leading-[1.6] text-[color:var(--bc-silver)]">{credit.role}</p>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-[0.9rem] md:justify-end">
        {credit.license && (
          <a href={credit.license.href} target="_blank" rel="noopener noreferrer license" className={`inline-flex min-h-11 items-center text-[color:var(--bc-silver)] hover:text-white ${LINK}`}>
            {credit.license.name}
            <span className="sr-only"> licence (opens in a new tab)</span>
          </a>
        )}
        <a href={credit.href} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center font-semibold text-white ${LINK}`}>
          Visit<span className="sr-only"> {credit.name} (opens in a new tab)</span>
        </a>
      </p>
    </li>
  );
}

/** One photograph: what it shows, who took it, under which licence, linked to its Commons file page. */
function PhotoRow({ photo }: { photo: PhotoCredit }) {
  return (
    <li className="grid gap-x-8 gap-y-1.5 border-b border-[color:var(--bc-rule)] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
      <div className="min-w-0">
        <p className="font-semibold text-white [overflow-wrap:anywhere]">{photo.subject}</p>
        <p className="mt-1 text-[0.95rem] text-[color:var(--bc-silver)] [overflow-wrap:anywhere]">
          Photo: {photo.author ?? 'Wikimedia Commons contributor'}
          {photo.license && (
            <>
              {', '}
              {photo.licenseUrl ? (
                <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer license" className={`text-[color:var(--bc-silver)] hover:text-white ${LINK}`}>
                  {photo.license}<span className="sr-only"> licence (opens in a new tab)</span>
                </a>
              ) : photo.license}
            </>
          )}
          <span className="text-[color:var(--bc-titanium)]"> · {photo.usedOn}</span>
        </p>
      </div>
      <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center text-[0.9rem] font-semibold text-white ${LINK}`}>
        File page<span className="sr-only"> for the photo of {photo.subject} on Wikimedia Commons (opens in a new tab)</span>
      </a>
    </li>
  );
}

/**
 * Every credit Apex owes, in one place and nowhere else: data, F1 media,
 * each Wikimedia Commons photograph with its author and licence (read from
 * the same lookups the pages use), newsrooms, software, typefaces, the
 * fan-concept statement and the non-affiliation and trademark notice.
 * Built from lib/credits.ts so it can never drift from what the site uses.
 */
export default async function ReferencesPage() {
  const photos = await loadPhotoCredits();
  const photoCount = photos.circuits.length + photos.champions.length;
  const nav = [
    ...REFERENCE_GROUPS.map((g) => ({ id: g.id, title: g.title, count: g.credits.length as number | null })),
    { id: 'photographs', title: 'Photographs', count: photoCount || null },
    { id: 'notice', title: 'The fine print', count: null },
  ];
  return (
    <article className="bc bcp relative isolate overflow-x-clip [&_a]:scroll-mt-28">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh]" />
      <section aria-labelledby="references-title" className="ds-container pb-16 pt-14 md:pb-24 md:pt-24">
        <div className="grid items-end gap-x-10 gap-y-12 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <Eyebrow className="bc-in-up">With thanks</Eyebrow>
            <h1 id="references-title" className="mt-5 text-white">
              <span className="bc-mask bcp-fit" style={fitDisplay('References', { max: 8, lg: 0.56 })}><span className="bc-display bc-in-rise" style={{ '--d': '60ms' } as CSSProperties}>References</span></span>
            </h1>
            <p className="bc-serif bc-in-up mt-7 max-w-[32ch] text-pretty text-[clamp(1.4rem,1.1rem+1.3vw,2.2rem)] leading-[1.25] text-white" style={{ '--d': '180ms' } as CSSProperties}>
              {BRAND_STATEMENT} It stands on the generous work of the people and projects below.
            </p>
          </div>
          <nav aria-label="On this page" className="bc-in-up min-w-0 lg:col-span-5" style={{ '--d': '240ms' } as CSSProperties}>
            <ul className="bcp-panel overflow-hidden px-5 py-2">
              {nav.map((g) => (
                <li key={g.id} className="border-b border-[color:var(--bc-rule)] last:border-b-0">
                  <a href={`#${g.id}`} className="flex min-h-12 items-center justify-between gap-4 py-2 text-[0.98rem] text-[color:var(--bc-silver)] transition-colors hover:text-white">
                    {g.title}
                    {g.count !== null && <span className="bc-mono text-[0.85rem] text-[color:var(--bc-titanium)]">{g.count}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
      <div aria-hidden className="bcp-horizon" />

      {REFERENCE_GROUPS.map((g, i) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className={`border-b border-[color:var(--bc-rule)] py-16 md:py-24 ${i % 2 === 0 ? 'bc-carbon' : ''}`}>
          <div className="ds-container grid gap-x-10 gap-y-8 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-5">
              <div className="lg:sticky lg:top-[calc(var(--nav-offset,0px)+2rem)]">
                <SectionTitle id={`${g.id}-title`} title={g.title}>{g.intro}</SectionTitle>
              </div>
            </div>
            <ul className="min-w-0 border-t border-[color:var(--bc-rule-strong)] lg:col-span-7">
              {g.credits.map((c) => <CreditRow key={`${c.name}|${c.href}`} credit={c} />)}
            </ul>
          </div>
        </section>
      ))}

      <section id="photographs" aria-labelledby="photographs-title" className="border-b border-[color:var(--bc-rule)] py-16 md:py-24">
        <div className="ds-container grid gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <div className="lg:sticky lg:top-[calc(var(--nav-offset,0px)+2rem)]">
              <SectionTitle id="photographs-title" title="Photographs">
                Circuit photographs and champions’ portraits come from Wikimedia Commons. Each one is listed with its photographer and licence, linked to its file page.
              </SectionTitle>
            </div>
          </div>
          <div className="min-w-0 lg:col-span-7">
            {photoCount === 0 ? (
              <div className="bcp-panel p-6 md:p-8">
                <p className="bc-wide text-[1.2rem] text-white">Photo credits unavailable right now</p>
                <p className="mt-2 text-[color:var(--bc-silver)]">The list of photographs can’t be read at the moment. It returns here on its own.</p>
              </div>
            ) : (
              <>
                {photos.circuits.length > 0 && (
                  <>
                    <h3 className="bc-label text-[color:var(--bc-titanium)]">Circuits</h3>
                    <ul className="mt-3 border-t border-[color:var(--bc-rule-strong)]">
                      {photos.circuits.map((p) => <PhotoRow key={p.sourceUrl} photo={p} />)}
                    </ul>
                  </>
                )}
                {photos.champions.length > 0 && (
                  <>
                    <h3 className="bc-label mt-12 text-[color:var(--bc-titanium)]">World champions</h3>
                    <ul className="mt-3 border-t border-[color:var(--bc-rule-strong)]">
                      {photos.champions.map((p) => <PhotoRow key={p.sourceUrl} photo={p} />)}
                    </ul>
                  </>
                )}
                {!photos.complete && <p className="mt-6 text-[0.9rem] text-[color:var(--bc-titanium)]">Some photographs could not be looked up just now, so this list may be missing a few. It completes itself on the next update.</p>}
              </>
            )}
          </div>
        </div>
      </section>

      <section id="notice" aria-labelledby="notice-title" className="bc-carbon py-16 md:py-24">
        <div className="ds-container grid gap-x-10 gap-y-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <SectionTitle id="notice-title" title="The fine print">Who Apex is, what it is not, and whose marks these are.</SectionTitle>
          </div>
          <div className="grid min-w-0 gap-6 lg:col-span-7">
            <p className="bc-serif text-[clamp(1.35rem,1.1rem+1vw,1.9rem)] leading-[1.3] text-white">
              {BRAND_STATEMENT} A fan concept, made by one person, with no commercial relationship to the sport.
            </p>
            <p className="max-w-[64ch] text-[1.05rem] leading-relaxed text-white">{NON_AFFILIATION_STATEMENT}</p>
            <p className="max-w-[64ch] leading-relaxed text-[color:var(--bc-silver)]">{TRADEMARK_NOTICE}</p>
            <p className="max-w-[64ch] leading-relaxed text-[color:var(--bc-silver)]">
              If you own something shown here and would like it credited differently or removed, please use the{' '}
              <Link href="/legal/dmca" className={`font-semibold text-white ${LINK}`}>copyright page</Link> or{' '}
              <Link href="/contact" className={`font-semibold text-white ${LINK}`}>get in touch</Link>. The full{' '}
              <Link href="/legal/disclaimer" className={`font-semibold text-white ${LINK}`}>disclaimer</Link> has more.
            </p>
          </div>
        </div>
      </section>
    </article>
  );
}
