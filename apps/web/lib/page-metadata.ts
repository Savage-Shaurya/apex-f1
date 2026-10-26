import type { Metadata } from 'next';

/** Site name appended to per-page social titles (same as the root title template). */
export const SITE_NAME = 'Apex';

function plainTitle(title: Metadata['title']): string | null {
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object') {
    if ('absolute' in title && typeof title.absolute === 'string') return title.absolute;
    if ('default' in title && typeof title.default === 'string') return title.default;
  }
  return null;
}

function canonicalPath(alternates: Metadata['alternates']): string | null {
  const canonical = alternates?.canonical;
  if (typeof canonical === 'string') return canonical;
  if (canonical instanceof URL) return canonical.toString();
  if (canonical && typeof canonical === 'object' && 'url' in canonical) return String(canonical.url);
  return null;
}

/**
 * Per-page Open Graph and Twitter tags (R3-REG-2). In Next a page's
 * `openGraph`/`twitter` replace the root layout's whole objects, so a page
 * that sets only `title` shares the site-wide og:title/description and has no
 * og:url. This fills them from the page's own title, description and
 * canonical path (resolved against metadataBase, the canonical origin from
 * NEXT_PUBLIC_SITE_URL via siteOrigin()). Anything the page sets itself is kept.
 */
export function withSocial(metadata: Metadata): Metadata {
  const title = plainTitle(metadata.title);
  if (!title) return metadata;
  const absolute = typeof metadata.title === 'object' && metadata.title !== null && 'absolute' in metadata.title;
  const socialTitle = absolute || title.endsWith(` · ${SITE_NAME}`) ? title : `${title} · ${SITE_NAME}`;
  const description = typeof metadata.description === 'string' ? metadata.description : undefined;
  const url = canonicalPath(metadata.alternates) ?? undefined;
  const openGraph = (metadata.openGraph ?? {}) as Record<string, unknown>;
  const twitter = (metadata.twitter ?? {}) as Record<string, unknown>;
  return {
    ...metadata,
    openGraph: {
      type: 'website', siteName: SITE_NAME, locale: 'en_US',
      title: socialTitle,
      ...(description ? { description } : {}),
      ...(url ? { url } : {}),
      ...openGraph,
    } as Metadata['openGraph'],
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      ...(description ? { description } : {}),
      ...twitter,
    } as Metadata['twitter'],
  };
}
