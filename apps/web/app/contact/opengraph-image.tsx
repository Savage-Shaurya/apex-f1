import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from '@/lib/og/card';

// Share image (final audit F-04): this page's own title, drawn once at build.
export const alt = "Apex: Contact Apex. Corrections and tips, collaboration, copyright notices and security reports.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return renderOgCard({ kicker: "Contact", title: "Contact Apex", subtitle: "Corrections and tips, collaboration, copyright notices and security reports." });
}
