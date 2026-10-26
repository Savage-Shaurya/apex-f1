import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: References. The data, images, newsrooms, software and typefaces Apex is built on.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "References", title: "References", subtitle: "The data, images, newsrooms, software and typefaces Apex is built on." });
}
