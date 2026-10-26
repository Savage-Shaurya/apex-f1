import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Terms of Use. The terms for using Apex, an unofficial Formula 1 fan website.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Legal", title: "Terms of Use", subtitle: "The terms for using Apex, an unofficial Formula 1 fan website." });
}
