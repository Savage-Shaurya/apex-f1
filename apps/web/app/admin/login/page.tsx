import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import type { Metadata } from 'next';
import { AdminLoginForm } from './form';

export const metadata: Metadata = { title: 'Admin sign in', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  return (
    // Static height (svh, fixed header allowance): --nav-offset drops to 0 when the header hides on scroll and dvh grows as
    // mobile browser bars collapse, and either would resize this frame and push the footer (a layout shift).
    <div className="bc bcp relative isolate flex min-h-[calc(100svh-6rem)] items-start justify-center overflow-x-clip px-4 py-12 sm:items-center sm:py-16">
      <div aria-hidden className="bcp-flood pointer-events-none absolute inset-0 -z-10" />
      <article className="bcp-panel w-full max-w-[26rem] p-6 sm:p-8">
        <h1 className="bc-wide text-[1.6rem] text-white">Apex admin</h1>
        <p className="mt-2 font-text text-small text-fg-2">Sign in with your administrator username, password and the current code from your authenticator app.</p>
        <AdminLoginForm />
        <p className="mt-8 font-text text-caption text-fg-3">This area is for the site owner. Attempts are rate limited.</p>
      </article>
    </div>
  );
}
