'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { m, useReducedMotion } from 'framer-motion';
import { ModalDialog } from '@/components/shell/ModalDialog';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { ease, seconds } from '@/components/motion/tokens';
import { searchSeasonSuggestions, type NavSeasons } from './nav-config';

/** Search overlay: one large field, real destinations as suggestions, Escape to close. */
export function SiteSearch({ seasons, onClose }: { seasons: NavSeasons; onClose: () => void }) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const go = (href: string) => { router.push(href); onClose(); };
  const suggestions = [
    { label: 'Next race', href: '/schedule#next' },
    ...searchSeasonSuggestions(seasons),
    { label: 'Current grid', href: '/drivers' },
    { label: 'World champions', href: '/drivers/champions' },
    { label: 'Session timing', href: '/live/timing' },
  ];

  return (
    <ModalDialog label="Search Apex" onClose={onClose}>
      <m.div className="relative min-h-dvh" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduced ? {} : { opacity: 0 }} transition={{ duration: seconds.base }}>
        <button type="button" aria-label="Close search" onClick={onClose} className="absolute inset-0 cursor-default bg-ground-deep/95" />
        <m.div className="ds-container relative pt-[14vh]" initial={reduced ? false : { y: -20 }} animate={{ y: 0 }} transition={{ duration: seconds.slow, ease: ease.out }}>
          <form
            role="search"
            onSubmit={(e) => { e.preventDefault(); const t = q.trim(); go(t ? `/search?q=${encodeURIComponent(t)}` : '/search'); }}
            className="tone-carbon mx-auto max-w-3xl bg-transparent"
          >
            <label htmlFor="ds-site-search" className="font-text text-ui font-[650] text-fg-2">Search drivers, teams, races and seasons</label>
            <div className="mt-3 flex items-center gap-3 shadow-[inset_0_-2px_0_var(--rule-strong)] focus-within:shadow-[inset_0_-3px_0_var(--color-brand-red)]">
              <Icon name="search" size={28} className="shrink-0 text-fg-3" />
              <input
                ref={input}
                id="ds-site-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Verstappen, Monaco, 1988"
                autoComplete="off"
                className="min-h-16 w-full min-w-0 bg-transparent font-display text-[clamp(1.75rem,4vw,3rem)] font-[750] tracking-[0em] text-fg placeholder:text-fg-3 focus:outline-none"
              />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <Button type="submit" icon="arrow-right">Search</Button>
              <p className="font-text text-small text-fg-3">Press Escape to close</p>
            </div>
            <ul className="mt-8 grid gap-1 sm:grid-cols-2">
              {suggestions.map((s) => (
                <li key={s.href}>
                  <button type="button" onClick={() => go(s.href)} className="group flex min-h-12 w-full items-center justify-between gap-3 bg-tone-raised px-4 text-left font-text text-ui text-fg-2 transition-colors hover:bg-tone-hover hover:text-fg">
                    {s.label}
                    <Icon name="arrow-right" size={16} className="text-accent transition-transform group-hover:translate-x-1" />
                  </button>
                </li>
              ))}
            </ul>
          </form>
        </m.div>
      </m.div>
    </ModalDialog>
  );
}
