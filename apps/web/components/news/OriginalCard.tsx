import Link from 'next/link';
import type { ApexArticleSummary } from '@apex/db';
import { cn } from '@apex/ui';
import { Container, Grid, Heading, Media, Text, Unavailable } from '@/components/ds';
import { utcLongDate } from './news-format';

type OriginalLike = Pick<ApexArticleSummary, 'slug' | 'title' | 'dek' | 'section' | 'heroImageUrl' | 'readTimeMinutes' | 'publishedAt'>;

function metaLine(a: OriginalLike): string {
  return [a.section, a.readTimeMinutes ? `${a.readTimeMinutes} min read` : '', a.publishedAt ? utcLongDate(new Date(a.publishedAt).getTime()) : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * An Apex Original: written in-house and read on Apex, so it opens in place
 * (no new tab) and its standfirst speaks in the editorial serif, which keeps
 * it distinct from a wire link. The picture sits above the words, never
 * under them.
 */
export function OriginalCard({ a, lead = false, className }: { a: OriginalLike; lead?: boolean; className?: string }) {
  return (
    <article className={cn('group/story relative flex min-w-0 flex-col gap-4', className)}>
      {a.heroImageUrl && (
        <div className="overflow-hidden">
          <div className="transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover/story:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover/story:scale-100">
            <Media src={a.heroImageUrl} alt="" kind={lead ? 'wide' : 'photo'} sizes={lead ? '(max-width: 1024px) 100vw, 55vw' : '(max-width: 768px) 100vw, 30vw'} />
          </div>
        </div>
      )}
      <div className="min-w-0">
        <p className="font-text text-caption text-fg-3">
          <span className="font-[650] text-accent">Apex Original</span>
          {metaLine(a) && <span> · {metaLine(a)}</span>}
        </p>
        <Heading level={3} size={lead ? 'heading-l' : 'heading-m'} caps={false} className="mt-2 transition-colors duration-[var(--duration-base)] group-hover/story:text-accent">
          <Link href={`/article/${a.slug}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none [&:focus-visible]:underline">
            {a.title}
          </Link>
        </Heading>
        {a.dek && <Text editorial size={lead ? 'lead' : 'body'} tone="muted" className="mt-3 max-w-[52ch]">{a.dek}</Text>}
      </div>
    </article>
  );
}

/** The in-house band on /latest: shown only when Originals exist or their store is down. */
export function OriginalsBand({ articles, unavailable }: { articles: OriginalLike[]; unavailable: boolean }) {
  const [first, ...rest] = articles;
  return (
    <section aria-labelledby="originals-title" className="tone-raised mt-[var(--space-block)] py-[var(--space-block)]">
      <Container>
        <Grid className="gap-y-8">
          <div className="col-span-4 md:col-span-8 lg:col-span-3">
            <Heading level={2} id="originals-title" size="display-m">Apex Originals</Heading>
            <Text editorial size="lead" tone="muted" className="mt-4 max-w-[30ch]">Written by Apex and read here, not at another site.</Text>
          </div>
          <div className="col-span-4 md:col-span-8 lg:col-span-9">
            {unavailable ? (
              <Unavailable compact title="Apex stories unavailable">
                These stories can’t be shown right now. The latest news is unaffected.
              </Unavailable>
            ) : first ? (
              <div className="grid gap-x-[var(--gutter)] gap-y-10 lg:grid-cols-9">
                <OriginalCard a={first} lead className={rest.length ? 'lg:col-span-5' : 'lg:col-span-9'} />
                {rest.length > 0 && (
                  <div className="flex flex-col gap-8 lg:col-span-4">
                    {rest.map((a) => <OriginalCard key={a.slug} a={{ ...a, heroImageUrl: null }} />)}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </Grid>
      </Container>
    </section>
  );
}
