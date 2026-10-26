import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Privacy Policy. What personal data Apex handles, why, and your rights.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Legal", title: "Privacy Policy", subtitle: "What personal data Apex handles, why, and your rights." });
}
