import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Disclaimer. Not affiliated with Formula 1, FIA, FOM, Liberty Media, or any team or driver.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Legal", title: "Disclaimer", subtitle: "Not affiliated with Formula 1, FIA, FOM, Liberty Media, or any team or driver." });
}
