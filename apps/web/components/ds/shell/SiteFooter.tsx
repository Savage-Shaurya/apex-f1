import Link from 'next/link';
import type { ReactNode } from 'react';
import { CookieSettingsButton } from '@/components/shell/CookieSettingsButton';
import { analyticsConfigured } from '@/lib/analytics-config';
import { Icon } from '../Icon';
import { Wordmark } from './Wordmark';
import { footerGroups, legalLinks, GIVE_BACK_LABEL } from './nav-config';
import { SOCIAL_LINKS, type SocialLink } from './social';

const DEFAULT_STATEMENT = 'Apex is an independent, fan-built Formula 1 platform.';

/**
 * Small line glyphs for the social links, drawn on the icon grid (24, 1.75 stroke). Decorative: each link carries its own name.
 * Built at render (not at module load) so the footer module imports cleanly anywhere.
 */
const glyph = (id: SocialLink['id']): ReactNode => ({
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.25" cy="6.75" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  x: <path d="M4.5 4h4.2l10.8 16h-4.2L4.5 4Zm14.6 0-5.9 6.7m-2.4 2.6L4.9 20" />,
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 10.5V16M8 7.75v.01M11.5 16v-5.5m0 2.5c0-1.6 1-2.6 2.4-2.6s2.1.9 2.1 2.6V16" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.75 7 8.25 6 8.25-6" />
    </>
  ),
})[id];

/**
 * The close of every page, quiet and short: who Apex is, where to go next,
 * where to follow along, the Give back invitation (the owner's animal
 * charity page, never demoted), then the legal links. Every credit, licence and
 * the non-affiliation statement live on /references, linked here, so the footer stays clean.
 */
export function SiteFooter({
  season,
  statement = DEFAULT_STATEMENT,
  preview = false,
}: {
  /** The season whose standings are published (lib/season.ts), for the Results link; null when unconfirmed. */
  season: number | null;
  statement?: string;
  /** Design preview: no second contentinfo landmark and a distinct nav name, so landmarks stay unique. */
  preview?: boolean;
}) {
  const year = new Date().getUTCFullYear();
  const Root = preview ? 'div' : 'footer';
  return (
    <Root data-shell={preview ? 'footer-preview' : 'footer'} className="tone-deep relative overflow-hidden">
      <div className="ds-container">
        <div className="grid gap-x-8 gap-y-14 pb-14 pt-16 md:pt-20 lg:grid-cols-12">
          {/* Who we are, follow along, give back */}
          <div className="min-w-0 lg:col-span-5">
            <Wordmark size="md" />
            <p className="mt-6 max-w-[24ch] text-balance font-text text-heading-m leading-[1.25] tracking-[0.005em] text-fg">
              {/* Non-breaking hyphen keeps "fan-built" on one line. */}
              {statement.replace('fan-built', 'fan\u2011built')}
            </p>

            <ul aria-label={preview ? 'Follow Apex (preview)' : 'Follow Apex'} className="mt-8 flex flex-wrap gap-2">
              {SOCIAL_LINKS.map((s) => {
                const external = s.href.startsWith('http');
                return (
                  <li key={s.id}>
                    <a
                      href={s.href}
                      target={external ? '_blank' : undefined}
                      rel={external ? 'noopener noreferrer me' : undefined}
                      aria-label={s.accessibleName}
                      title={s.handle}
                      className="group inline-flex size-11 items-center justify-center rounded-full text-fg-2 shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-[color,box-shadow,background-color] duration-[var(--duration-base)] hover:bg-tone-hover hover:text-fg hover:shadow-[inset_0_0_0_1px_var(--fg-3)] focus-visible:text-fg"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
                        {glyph(s.id)}
                      </svg>
                    </a>
                  </li>
                );
              })}
            </ul>

            <Link
              href="/support"
              className="group mt-10 flex max-w-[26rem] items-center justify-between gap-6 bg-tone-raised px-5 py-5 shadow-[inset_3px_0_0_var(--color-brand-red)] transition-colors duration-[var(--duration-base)] hover:bg-tone-hover"
            >
              <span className="min-w-0">
                <span className="block font-text text-label uppercase text-accent">{GIVE_BACK_LABEL}</span>
                <span className="mt-2 block font-text text-ui font-[650] text-fg">One small kindness for an animal near you.</span>
              </span>
              <Icon name="arrow-right" size={20} className="shrink-0 text-fg-2 transition-transform duration-[var(--duration-base)] group-hover:translate-x-1 group-hover:text-fg" />
            </Link>
          </div>

          {/* Where to go next */}
          <nav aria-label={preview ? 'Footer (preview)' : 'Footer'} className="grid min-w-0 grid-cols-2 content-start gap-x-6 gap-y-10 sm:grid-cols-4 lg:col-span-7 lg:pl-8">
            {footerGroups(season).map((g) => (
              <div key={g.title} className="min-w-0">
                <h2 className="font-text text-label uppercase text-fg-3">{g.title}</h2>
                <ul className="mt-3">
                  {g.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="inline-flex min-h-11 items-center font-text text-ui tracking-[0.01em] text-fg-2 transition-colors hover:text-fg">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Legal line */}
        <div className="flex flex-col gap-4 py-6 shadow-[inset_0_1px_0_var(--rule)] lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <p className="font-text text-small tracking-[0.01em] text-fg-3">
            © {year} Apex
          </p>
          <ul aria-label="Legal" className="-mx-2 flex flex-wrap items-center">
            {legalLinks().map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center px-2 font-text text-small tracking-[0.01em] text-fg-2 transition-colors hover:text-fg">
                  {l.label}
                </Link>
              </li>
            ))}
            {/* Only when there is a consent choice to change (an analytics provider is configured). */}
            {analyticsConfigured() && (
              <li>
                <CookieSettingsButton className="inline-flex min-h-11 items-center px-2 font-text text-small tracking-[0.01em] text-fg-2 transition-colors hover:text-fg" />
              </li>
            )}
          </ul>
        </div>
      </div>

      <div aria-hidden className="ds-container pb-2">
        <Wordmark size="xl" className="w-full text-fg" />
      </div>
    </Root>
  );
}
