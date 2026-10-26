/**
 * Permanent (308) redirects, answered by next.config.ts before any render.
 * - /careers: Apex is a solo project with no open roles; old links land on About.
 * - /membership, /account: removed vaporware pages; they land on Give back (R3-REG-4).
 */
export const PERMANENT_REDIRECTS = [
  { source: '/careers', destination: '/about', permanent: true },
  { source: '/membership', destination: '/support', permanent: true },
  { source: '/account', destination: '/support', permanent: true },
] as const;
