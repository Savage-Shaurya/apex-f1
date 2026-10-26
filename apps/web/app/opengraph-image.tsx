import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// The site's default share image (home and any page without its own card), in the Carbon & Light style.
export const alt = 'Apex is an independent, fan-built Formula 1 platform.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OG() {
  return renderOgCard({ kicker: 'Schedule · Results · Standings · News', title: 'An independent, fan-built Formula 1 platform', tone: 'headline' });
}
