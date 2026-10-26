import type { Metadata } from 'next';
import { Heading, StatusBadge, Text } from '@/components/ds';
import { ArticleEditor } from './editor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin · Articles',
  robots: { index: false, follow: false },
};

export default function AdminArticlesPage() {
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  return (
    <article>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <Heading level={1} size="heading-l">Articles</Heading>
        <StatusBadge status={dbConfigured ? 'finished' : 'unavailable'}>{dbConfigured ? 'Storage configured' : 'Storage not configured'}</StatusBadge>
      </div>
      <Text tone="muted" className="mt-2" measure>
        {dbConfigured
          ? 'Open a draft to keep writing, or refine an article already on the site. Every save checks the stored revision to protect changes made by another editor.'
          : 'Article storage is not configured, so loading, saving and publishing are unavailable until a database is connected.'}
      </Text>
      <div className="mt-8">
        <ArticleEditor enabled={dbConfigured} />
      </div>
    </article>
  );
}
