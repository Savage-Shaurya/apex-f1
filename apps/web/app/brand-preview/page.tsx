import { permanentRedirect } from 'next/navigation';

/** The Carbon & Light preview became the homepage (2026-10-26). */
export default function BrandPreviewPage() {
  permanentRedirect('/');
}
