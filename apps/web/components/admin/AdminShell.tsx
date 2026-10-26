'use client';
import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@apex/ui';
import { Button, Container, Label } from '@/components/ds';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/articles', label: 'Articles' },
];

/**
 * The console frame: a left rail on wide screens (a row on phones) with the
 * sections and sign out. App-screen rules: no hero type, no decoration.
 * The sign-in page renders without the frame.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (pathname === '/admin/login') return <>{children}</>;

  async function logout() {
    if (busy) return;
    setBusy(true); setMessage('');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}', signal: controller.signal });
      if (response.ok) { router.replace('/admin/login'); router.refresh(); return; }
      setMessage('Sign out could not be confirmed. Please try again.');
    } catch { setMessage('Sign out could not be confirmed. Please try again.'); }
    finally { clearTimeout(deadline); setBusy(false); }
  }

  return (
    <div className="bc bcp relative isolate overflow-x-clip [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28 [&_select]:scroll-mt-28">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-x-0 top-0 -z-10 h-[90vh]" />
      <Container className="grid gap-x-12 gap-y-6 py-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:py-12">
        <div className="min-w-0">
          <div className="lg:sticky lg:top-[calc(var(--nav-offset)+2rem)]">
            <p className="font-text text-heading-s text-fg">Apex admin</p>
            <Label as="p" className="mt-1">Editorial console</Label>
            <nav aria-label="Admin sections" className="mt-5">
              <ul className="flex flex-wrap gap-x-6 gap-y-1 shadow-[inset_0_-1px_0_var(--rule)] lg:flex-col lg:gap-0 lg:shadow-[inset_1px_0_0_var(--rule)]">
                {NAV.map((item) => {
                  const current = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                          'relative flex min-h-11 items-center font-text text-ui font-[650] transition-colors lg:pl-4',
                          current ? 'text-fg shadow-[inset_0_-2px_0_var(--color-brand-red)] lg:shadow-[inset_2px_0_0_var(--color-brand-red)]' : 'text-fg-2 hover:text-fg',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="mt-6">
              <Button variant="secondary" loading={busy} onClick={logout}>Sign out</Button>
              <p role="status" aria-live="polite" className="mt-2 font-text text-small text-accent">{message}</p>
            </div>
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </Container>
    </div>
  );
}
