'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { getConsent, saveConsent, subscribeToConsentChanges, type ConsentPreferences } from '@/lib/analytics';
import { Button } from '../Button';
import { Checkbox } from '../Form';
import { ease, seconds } from '@/components/motion/tokens';

const FIRST_PAINT_DELAY = 900;

/**
 * Cookie consent (new shell). Reject and Accept have equal weight; analytics
 * stays off until accepted. Reopened from the footer's "Cookie preferences"
 * (window event `apex:open-consent`). Storage failure is reported, never
 * hidden. The layout renders it straight after the skip link, so it is
 * first in the tab order; while open it reserves its height at the bottom
 * of the scroll port so focused content is never hidden behind it.
 */
export function ConsentBanner({ preview = false }: { /** Render inline and open, without timers or storage (design preview). */ preview?: boolean } = {}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(preview);
  const [detail, setDetail] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (preview) return;
    const sync = () => setAnalytics(getConsent()?.analytics === true);
    const reopen = () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      sync();
      setDetail(true);
      setOpen(true);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('input, button')?.focus());
    };
    const timer = getConsent() ? undefined : window.setTimeout(() => { if (!getConsent()) { sync(); setOpen(true); } }, FIRST_PAINT_DELAY);
    const unsubscribe = subscribeToConsentChanges(sync);
    window.addEventListener('apex:open-consent', reopen);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('apex:open-consent', reopen);
    };
  }, [preview]);

  // While the banner is open, focused controls scroll clear of it: the page's
  // scroll-padding-bottom follows the banner's height (WCAG 2.4.11).
  useEffect(() => {
    if (preview || !open) return;
    const el = root.current;
    const html = document.documentElement;
    if (!el) return;
    // Everything from the banner's top edge to the bottom of the viewport (its height plus the desktop inset).
    const apply = () => html.style.setProperty('--consent-h', `${Math.max(0, Math.ceil(window.innerHeight - el.getBoundingClientRect().top))}px`);
    apply();
    const settle = window.setTimeout(apply, 700); // after the entrance transform
    const watch = new ResizeObserver(apply);
    watch.observe(el);
    window.addEventListener('resize', apply);
    // Short or zoomed viewports (400% zoom is 320x256): scroll-padding alone can
    // leave a focused control under the bar when the browser sees it as
    // partly visible, so a control the bar covers is brought to the middle of
    // the screen (WCAG 2.4.11).
    const reveal = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement) || el.contains(target)) return;
      if (target.getBoundingClientRect().bottom > el.getBoundingClientRect().top + 1) target.scrollIntoView({ block: 'center', inline: 'nearest' });
    };
    document.addEventListener('focusin', reveal);
    return () => { window.clearTimeout(settle); watch.disconnect(); window.removeEventListener('resize', apply); document.removeEventListener('focusin', reveal); html.style.removeProperty('--consent-h'); };
  }, [open, preview, detail, storageError]);

  const save = (value: ConsentPreferences) => {
    if (preview) return;
    const ok = saveConsent(value);
    setStorageError(!ok);
    if (!ok) return;
    setOpen(false);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  };
  const now = () => new Date().toISOString();

  return (
    <AnimatePresence>
      {open && (
        <m.div
          ref={root}
          role="region"
          aria-label={preview ? 'Cookie consent (preview)' : 'Cookie consent'}
          data-shell="consent"
          className={preview ? 'tone-raised relative w-full max-w-[60rem] shadow-[var(--shadow-overlay)]' : 'tone-raised fixed inset-x-0 bottom-0 z-[var(--z-consent)] max-h-[calc(100dvh-1rem)] overflow-y-auto shadow-[var(--shadow-overlay)] md:inset-x-5 md:bottom-5 md:mx-auto md:max-w-[60rem]'}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          initial={reduced || preview ? false : { opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? {} : { opacity: 0, y: 32, transition: { duration: seconds.fast, ease: ease.exit } }}
          transition={{ duration: reduced ? 0 : seconds.slow, ease: ease.out }}
        >
          {/* Compact by design: on a phone one line of text over one row of
            * equal buttons (about 90px), one line on desktop, so it never
            * hides the page. "Choose" expands it. */}
          <div className="flex flex-col gap-2 px-4 py-2.5 md:flex-row md:items-center md:gap-6 md:px-5 md:py-3.5">
            <p className="min-w-0 flex-1 font-text text-small leading-snug text-fg-2 [text-wrap:wrap]">
              {/* Under 360px the short line drops its lead-in so it stays one line; the region is named "Cookie consent". */}
              <span className="font-[650] text-fg max-[359px]:hidden">Cookies<span className="sm:hidden">: </span><span className="hidden sm:inline">.</span></span>
              <span className="sm:hidden"><span className="min-[360px]:hidden">Analytics</span><span className="max-[359px]:hidden">analytics</span> only if you accept.</span>
              <span className="hidden sm:inline"> Anonymous analytics stay off unless you accept.</span>{' '}
              <Link href="/legal/privacy" className="whitespace-nowrap text-fg underline underline-offset-2 hover:text-accent">Privacy<span className="hidden sm:inline">&nbsp;policy</span></Link>
            </p>
            <div className="grid shrink-0 grid-cols-3 gap-2 md:flex">
              <Button variant="secondary" className="px-2.5 sm:px-4" onClick={() => save({ analytics: false, marketing: false, ts: now() })}>Reject</Button>
              <Button variant="inverse" className="px-2.5 sm:px-4" onClick={() => save({ analytics: true, marketing: false, ts: now() })}>Accept</Button>
              {detail ? (
                <Button variant="ghost" className="px-2.5 sm:px-4" onClick={() => save({ analytics, marketing: false, ts: now() })}>Save</Button>
              ) : (
                <Button variant="ghost" className="px-2.5 sm:px-4" aria-expanded={false} onClick={() => setDetail(true)}>Choose</Button>
              )}
            </div>
          </div>
          {(detail || storageError) && (
            <div className="px-4 pb-3.5 md:px-5">
              {detail && <Checkbox label="Anonymous analytics" description="Page views and performance, no advertising. Save keeps this choice." checked={analytics} onChange={(e) => setAnalytics(e.currentTarget.checked)} />}
              {storageError && (
                <p role="alert" className="mt-2 font-text text-small text-accent">Your browser blocked saving this choice. Analytics stay off for this visit.</p>
              )}
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
}
