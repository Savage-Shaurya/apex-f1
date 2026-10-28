import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: About Apex. An independent, fan-built Formula 1 platform, built by Snappy Crew.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "About", title: "About Apex", subtitle: "An independent, fan-built Formula 1 platform, built by Snappy Crew." });
}
