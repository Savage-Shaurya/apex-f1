import Link from 'next/link';
import type { ReactNode } from 'react';
import { SplitReveal } from '@/components/fx/SplitReveal';
import { SideIndex } from './SideIndex';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const DOCS = [
  { href: '/legal/disclaimer', label: 'Disclaimer' },
  { href: '/legal/dmca', label: 'Copyright' },
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
];

/**
 * Calm legal reading layout: title reveal, sibling-document switch, sticky
 * table of contents on desktop and a ~72ch reading column.
 */
export function LegalPage({
  title,
  current,
  updated,
  intro,
  sections,
}: {
  title: string;
  current: string;
  updated: string;
  intro?: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <article>
      <header className="border-b border-white/[0.07]">
        <div className="apex-container pb-10 pt-14 md:pb-14 md:pt-20">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <p className="flex items-center gap-3 font-data text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
              <span className="text-telemetry-red">Legal</span>
              <span aria-hidden className="h-px w-8 bg-white/20" />
              <span>Last updated <time dateTime={updated} className="text-on-background">{updated}</time></span>
            </p>
            <nav aria-label="Legal documents" className="flex flex-wrap gap-px border border-white/[0.08] bg-white/[0.08]">
              {DOCS.map((d) => {
                const on = d.href === current;
                return (
                  <Link
                    key={d.href}
                    href={d.href}
                    aria-current={on ? 'page' : undefined}
                    className={`inline-flex min-h-10 items-center px-4 font-data text-[11px] uppercase tracking-[0.16em] transition-colors ${on ? 'bg-telemetry-red text-white' : 'bg-background text-on-surface-variant hover:text-on-background'}`}
                  >
                    {d.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <SplitReveal as="h1" className="mt-10 font-display text-giant font-extrabold uppercase text-on-background">
            {title}
          </SplitReveal>
        </div>
      </header>

      <div className="apex-container grid gap-x-10 lg:grid-cols-12">
        <div className="hidden pt-14 lg:col-span-3 lg:block">
          <SideIndex items={sections.map((s) => ({ id: s.id, label: s.title }))} label="Contents" />
        </div>
        <div className="min-w-0 py-12 md:py-14 lg:col-span-8 xl:col-span-7">
          <div className="legal-copy max-w-[72ch] text-[17px] leading-[1.75] text-on-surface-variant [&_a]:text-telemetry-red [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-on-background [&_li]:pl-1 [&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p+p]:mt-4 [&_strong]:font-semibold [&_strong]:text-on-background [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 marker:text-telemetry-red">
            {intro && <div className="mb-4 border-l-2 border-telemetry-red pl-5 font-editorial text-[clamp(1.2rem,1.6vw,1.45rem)] leading-[1.5] text-on-background/90 [&_p+p]:mt-4">{intro}</div>}
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-28 border-t border-white/[0.07] pt-8 mt-10 first:mt-8">
                <h2 id={`${s.id}-h`} className="flex items-baseline gap-4 font-display text-[clamp(1.35rem,2vw,1.75rem)] font-extrabold uppercase leading-tight tracking-[-0.01em] text-on-background">
                  <span className="font-data text-[12px] font-normal tabular-nums tracking-[0.1em] text-telemetry-red">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </h2>
                <div className="mt-4">{s.body}</div>
              </section>
            ))}
            <p className="mt-14 border-t border-white/[0.07] pt-6 font-data text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">Last updated: {updated}</p>
          </div>
        </div>
      </div>
    </article>
  );
}
