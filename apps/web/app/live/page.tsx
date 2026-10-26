import { permanentRedirect } from 'next/navigation';

/** /live has no content of its own; the live centre opens on timing. */
export default function LiveIndexPage() {
  permanentRedirect('/live/timing');
}
