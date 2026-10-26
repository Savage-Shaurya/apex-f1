import { permanentRedirect } from 'next/navigation';

// /membership was a "$29 lifetime Apex+" pre-sale page for a subscription
// tier that is not implemented and has no payment backend. Per the project
// no-vaporware rule (any surface must hit a real live source or be
// hidden), the page redirects to /support (Give back), per the 2026-10-25
// user decision.
export default function MembershipPage() {
  // next.config.ts answers this path with a 308 first; this is the same permanent move if it is ever reached.
  permanentRedirect('/support');
}
