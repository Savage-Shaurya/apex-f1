import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Copyright & DMCA. How to ask Apex to remove material you believe infringes your copyright.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Legal", title: "Copyright & DMCA", subtitle: "How to ask Apex to remove material you believe infringes your copyright." });
}
