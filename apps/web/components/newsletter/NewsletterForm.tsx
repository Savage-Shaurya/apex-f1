'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@apex/ui';
import { Button, Icon } from '@/components/ds';
import { captureClient } from '@/lib/analytics';
import { submitNewsletter } from '@/lib/newsletter-submission';
import { emailProblem, submissionMessage } from './newsletter-copy';

/**
 * Race-week briefing sign-up, built on the ds field (underline that turns
 * red on focus) and tone-aware: on the red field the button inverts.
 *
 * Truthful states only: success is shown when the subscription service
 * accepted the address; an unconfirmed reply says so. While sending, the
 * field stays focusable (read-only + aria-disabled) so focus is not dropped
 * to the page (audit A11Y-8); on an error the field is marked invalid and
 * focused. One polite status node and one alert node never swap roles.
 */
export function NewsletterForm({ buttonVariant = 'primary', className }: { buttonVariant?: 'primary' | 'inverse'; className?: string }) {
  const id = useId();
  const inputId = `${id}-email`;
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const active = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const problem = emailProblem(email);
    if (problem) { setError(problem); setStatus(''); input.current?.focus(); return; }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    setDone(false);
    setStatus('Subscribing.');
    const result = await submitNewsletter(email, { signal: controller.signal });
    if (controller.signal.aborted || active.current !== controller) return;
    active.current = null;
    setPending(false);
    const message = submissionMessage(result);
    if (message.kind === 'success') {
      setStatus(message.text);
      setDone(true);
      setEmail('');
      captureClient('newsletter_subscribe');
    } else if (message.kind === 'none') {
      setStatus('');
    } else {
      setStatus('');
      setError(message.text);
      input.current?.focus();
    }
  }

  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(' ');

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending || undefined} className={cn('min-w-0', className)}>
      <label htmlFor={inputId} className="block font-text text-small font-[650] text-fg">Email address</label>
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end">
        <input
          ref={input}
          id={inputId}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          readOnly={pending}
          aria-disabled={pending || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => { setEmail(e.target.value); if (error) setError(''); if (done) { setDone(false); setStatus(''); } }}
          placeholder="name@example.com"
          className="min-h-13 w-full min-w-0 flex-1 bg-transparent px-0 py-2.5 font-text text-lead text-fg placeholder:text-[color-mix(in_oklab,var(--fg)_58%,transparent)] shadow-[inset_0_-1px_0_var(--control-edge)] transition-shadow duration-[var(--duration-fast)] focus:outline-none focus:shadow-[inset_0_-3px_0_var(--fg)] aria-invalid:shadow-[inset_0_-3px_0_var(--accent-text)]"
        />
        {/* Busy, never disabled: disabling the focused button would drop focus to the page (A11Y-8). Re-submits are ignored while sending. */}
        <Button type="submit" variant={buttonVariant} size="lg" loading={pending} disabled={false} aria-disabled={pending || undefined} icon="arrow-right" className="shrink-0">
          Subscribe
        </Button>
      </div>
      <p id={`${id}-hint`} className="mt-3 font-text text-caption text-fg-2">
        One email the Friday before each race (06:00 UTC). Unsubscribe from any edition. See the <Link href="/legal/privacy" className="underline decoration-[var(--rule-strong)] underline-offset-2 hover:text-fg">privacy policy</Link>.
      </p>
      <p role="status" aria-live="polite" className={cn('mt-3 flex items-start gap-2 font-text text-small text-fg', !status && 'sr-only')}>
        {done && <Icon name="check" size={18} className="mt-0.5 shrink-0" />}
        {status}
      </p>
      <p id={`${id}-error`} role="alert" className={cn('mt-3 flex items-start gap-2 font-text text-small font-[650] text-fg', !error && 'sr-only')}>
        {error && <Icon name="alert" size={18} className="mt-0.5 shrink-0" />}
        {error}
      </p>
    </form>
  );
}
