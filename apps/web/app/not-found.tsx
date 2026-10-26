import type { Metadata } from 'next';
import Link from 'next/link';
import '@/components/brand-c/brand-c.css';
import { Countdown } from '@/components/brand-c/live';
import { Icon } from '@/components/ds';
import { getShellCalendar } from '@/lib/grid';
import { preciseSessionTimestamp } from '@/lib/session-calendar';

export const metadata: Metadata = {
  title: '404: Out of session',
  // No robots here: Next already sends one noindex for a 404, so the page carries exactly one robots tag (SEO-7).
};

const WAYS_BACK = [
  { href: '/schedule', label: 'Race schedule', note: 'Every round, every session time' },
  { href: '/latest', label: 'Latest Formula 1 news', note: 'The newest stories' },
  { href: '/', label: 'Back to the home page', note: 'Apex front page' },
] as const;

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * 404 in Carbon & Light: big honest type on carbon (multi-line text is in the
 * metric-matched text face so a late font swap never re-wraps it), three real ways back and,
 * when the calendar answers, the real next race with its countdown. The
 * calendar read is the same request-cached one the header already makes, and
 * an outage simply leaves that block out, so the page always renders.
 */
export default async function NotFound() {
  const calendar = await getShellCalendar().catch(() => null);
  const next = calendar?.next ?? null;
  const timed = next ? preciseSessionTimestamp(next.raceStartIso) !== null : false;

  return (
    <section aria-labelledby="not-found-title" className="bc relative isolate overflow-hidden">
      <div aria-hidden className="bc-carbon absolute inset-0 -z-10" />
      <div aria-hidden className="bc-flood-static absolute inset-0 -z-10" />
      <div className="ds-container grid min-h-[calc(100svh-var(--shell-h))] content-start gap-14 lg:content-center py-16 md:py-24 lg:grid-cols-12 lg:items-end lg:gap-8">
        <div className="@container min-w-0 lg:col-span-7">
          <p className="bc-label flex items-center gap-3 text-[color:var(--bc-white)]"><span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />Error 404 · page not found</p>
          <h1 id="not-found-title" className="bc-display mt-6 text-[clamp(2.25rem,15cqi,8.5rem)]">
            Out of{' '}<br />session
          </h1>
          <p className="mt-8 max-w-[40ch] text-[clamp(1.125rem,1rem+0.55vw,1.5rem)] leading-[1.45] text-[color:var(--bc-silver)]">
            This page is not on the timing sheet. It may have moved, or the address may be mistyped.
          </p>
        </div>

        <div className="min-w-0 lg:col-span-5 lg:pb-2">
          <nav aria-label="Ways back">
            <ul className="border-t border-[color:var(--bc-rule-strong)]">
              {WAYS_BACK.map((w) => (
                <li key={w.href} className="border-b border-[color:var(--bc-rule-strong)]">
                  <Link href={w.href} className="group flex min-h-16 items-center justify-between gap-6 py-4 text-[color:var(--bc-white)]">
                    <span className="min-w-0">
                      <span className="block text-[clamp(1.0625rem,1rem+0.4vw,1.375rem)] font-[650] leading-tight">{w.label}</span>
                      <span className="mt-1 block text-[0.875rem] text-[color:var(--bc-titanium)]">{w.note}</span>
                    </span>
                    <Icon name="arrow-right" size={20} className="shrink-0 text-[color:var(--bc-red-text)] transition-transform duration-300 ease-[var(--bc-ease)] group-hover:translate-x-1 motion-reduce:transition-none" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {next && (
            <div className="mt-10">
              <p className="bc-label text-[color:var(--bc-titanium)]">Next race · round {next.round}</p>
              <Link
                href={`/schedule/${next.season}/${next.routeSlug ?? next.slug}`}
                className="mt-2 block text-[clamp(1.25rem,1rem+1vw,1.75rem)] font-[650] leading-tight text-[color:var(--bc-white)] underline decoration-[color:var(--bc-rule-strong)] underline-offset-4 hover:decoration-[color:var(--bc-red-text)] [overflow-wrap:anywhere]"
              >
                {next.name}
              </Link>
              <p className="mt-1 text-[0.875rem] text-[color:var(--bc-titanium)]">{next.circuitName}, {next.country}</p>
              <div className="mt-4">
                {timed ? (
                  <Countdown iso={next.raceStartIso} size="m" />
                ) : (
                  <p className="bc-mono text-[1.05rem] text-[color:var(--bc-silver)]">{DAY.format(new Date(next.date))} · start time not published</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
