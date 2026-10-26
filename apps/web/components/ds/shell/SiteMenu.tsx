'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';
import { ModalDialog } from '@/components/shell/ModalDialog';
import { Icon } from '../Icon';
import { Wordmark } from './Wordmark';
import { UTILITY_LINKS, type NavSection } from './nav-config';
import { ease, seconds } from '@/components/motion/tokens';

export interface MenuNextRace {
  round: number;
  name: string;
  country: string;
  href: string;
  startIso: string;
}

export interface MenuLead {
  title: string;
  source: string;
  href: string;
}

/**
 * Full-screen menu in a native modal dialog (focus contained, Escape closes,
 * focus returns to the opener). Sections are set large in Anybody; pointer
 * hover or keyboard focus previews a section's links on the right. At every
 * width each section also has a 44px disclosure that expands its links in
 * place, directly after the section in the tab order, so every link is
 * reachable by keyboard alone (WCAG 2.1.1), not only by hovering.
 */
export function SiteMenu({ sections, active, lead, nextRace, onClose }: { sections: NavSection[]; active?: string; lead: MenuLead | null; nextRace: MenuNextRace | null; onClose: () => void }) {
  const reduced = useReducedMotion();
  const mode = useRef<'pointer' | 'keyboard'>('pointer');
  const [focus, setFocus] = useState(active ?? sections[0]!.label);
  const [expanded, setExpanded] = useState<string | null>(null);
  const current = sections.find((s) => s.label === focus) ?? sections[0]!;

  return (
    <ModalDialog label="Site menu" onClose={onClose}>
      <m.div
        className="tone-deep relative min-h-dvh"
        onKeyDownCapture={(e) => { if (e.key === 'Tab') mode.current = 'keyboard'; }}
        onPointerMove={() => { mode.current = 'pointer'; }}
        initial={reduced ? false : { clipPath: 'inset(0 0 100% 0)' }}
        animate={{ clipPath: 'inset(0 0 0% 0)' }}
        exit={reduced ? {} : { clipPath: 'inset(0 0 100% 0)', transition: { duration: seconds.slow, ease: ease.inOut } }}
        transition={{ duration: reduced ? 0 : seconds.cinematic, ease: ease.out }}
      >
        <div className="ds-container flex h-[var(--header-h)] items-center justify-between shadow-[inset_0_-1px_0_var(--rule)]">
          <Link href="/" className="inline-flex min-h-11 items-center" aria-label="Apex home" onClick={onClose}>
            <Wordmark />
          </Link>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2.5 bg-brand-red px-4 font-text text-ui font-[650] text-white hover:bg-brand-red-hover">
            Close
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="ds-container grid gap-10 py-8 lg:grid-cols-12 lg:gap-8 lg:py-14">
          <nav aria-label="Sections" className="lg:col-span-7">
            <ul>
              {sections.map((s, i) => {
                const open = expanded === s.label;
                return (
                  <li key={s.label} className="overflow-hidden shadow-[inset_0_-1px_0_var(--rule)]">
                    <m.div
                      className="flex items-center"
                      initial={reduced ? false : { y: '110%' }}
                      animate={{ y: 0 }}
                      transition={{ duration: reduced ? 0 : seconds.cinematic, ease: ease.out, delay: reduced ? 0 : 0.12 + i * 0.04 }}
                    >
                      <Link
                        href={s.href}
                        onClick={onClose}
                        aria-current={s.label === active ? 'page' : undefined}
                        onMouseEnter={() => { if (mode.current === 'pointer') setFocus(s.label); }}
                        onFocus={() => setFocus(s.label)}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-4 py-2"
                      >
                        <span
                          className={cn(
                            'font-display text-[clamp(1.75rem,7.2vw,2.5rem)] font-[800] uppercase leading-[1.05] tracking-[0em] transition-colors duration-[var(--duration-base)] lg:text-[clamp(2.25rem,4.6vw,4.5rem)] lg:tracking-[0.003em]',
                            focus === s.label ? 'text-fg' : s.accent ? 'text-accent' : 'text-fg-3',
                          )}
                          style={{ fontStretch: '118%' }}
                        >
                          {s.label}
                        </span>
                        {s.label === active && <span className="ml-auto hidden font-text text-label uppercase text-accent lg:inline">You are here</span>}
                      </Link>
                      {s.links.length > 1 && (
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={`menu-links-${i}`}
                          aria-label={`${open ? 'Hide' : 'Show'} ${s.label} links`}
                          onClick={() => { setExpanded(open ? null : s.label); setFocus(s.label); }}
                          className="ml-2 inline-flex size-11 shrink-0 items-center justify-center text-fg shadow-[inset_0_0_0_1px_var(--rule-strong)] transition-colors hover:bg-tone-hover"
                        >
                          <Icon name={open ? 'minus' : 'plus'} size={18} />
                        </button>
                      )}
                    </m.div>
                    <ul id={`menu-links-${i}`} hidden={!open} className="pb-3 pl-1 lg:grid lg:grid-cols-2 lg:gap-x-6">
                      {s.links.map((l) => (
                        <li key={l.href}>
                          <Link href={l.href} onClick={onClose} className="flex min-h-11 items-center font-text text-body text-fg-2 hover:text-fg">{l.label}</Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </nav>

          <m.aside
            className="flex flex-col gap-8 lg:col-span-5 lg:pl-6"
            initial={reduced ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : seconds.cinematic, ease: ease.out, delay: reduced ? 0 : 0.3 }}
          >
            <div className="hidden lg:block">
              <p className="font-display text-heading-l font-semi-wide uppercase tracking-[0.01em] text-fg">{current.label}</p>
              <p className="mt-2 max-w-[40ch] font-text text-body text-fg-2">{current.blurb}</p>
              <ul className="mt-5 grid gap-1 sm:grid-cols-2">
                {current.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} onClick={onClose} className="group flex min-h-12 items-center justify-between gap-3 bg-tone-raised px-4 font-text text-ui text-fg-2 transition-colors hover:bg-tone-hover hover:text-fg">
                      {l.label}
                      <Icon name="arrow-right" size={16} className="text-accent transition-transform duration-[var(--duration-base)] group-hover:translate-x-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {nextRace && (
              <Link href={nextRace.href} onClick={onClose} className="group block bg-tone-raised p-5 transition-colors hover:bg-tone-hover">
                <p className="font-text text-label uppercase text-fg-3">Race weekend · Round {nextRace.round}</p>
                <p className="mt-2 font-display text-heading-l font-semi-wide uppercase tracking-[0.01em] text-fg">{nextRace.name}</p>
                <p className="mt-1 font-text text-small text-fg-2">{nextRace.country}</p>
              </Link>
            )}

            {lead && (
              <a href={lead.href} target="_blank" rel="noopener noreferrer" className="group block pl-4 shadow-[inset_3px_0_0_var(--color-brand-red)]">
                <p className="font-text text-small font-[650] text-fg-2">{lead.source}</p>
                <p className="mt-1 font-text text-heading-s text-fg group-hover:underline">{lead.title}</p>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}

            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {UTILITY_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} onClick={onClose} className="inline-flex min-h-11 items-center font-text text-ui text-fg-2 hover:text-fg">{l.label}</Link>
                </li>
              ))}
            </ul>
          </m.aside>
        </div>
      </m.div>
    </ModalDialog>
  );
}
