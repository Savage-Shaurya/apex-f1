import { Container, Skeleton } from '@/components/ds';

/** Title, the big field, the type filters and a column of result rows. */
export default function SearchLoading() {
  return (
    <div className="tone-carbon" aria-busy="true">
      <Container className="pb-[var(--space-section)] pt-[clamp(2.5rem,6vw,5rem)]">
        <Skeleton className="h-[clamp(2.25rem,0.6rem+9vw,10rem)] w-[min(100%,36rem)]" label="Loading the search directory" />
        <Skeleton className="mt-14 h-20 w-full" />
        <Skeleton className="mt-8 h-11 w-[min(100%,32rem)]" />
        <div className="mt-10 grid gap-x-10 md:grid-cols-2">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="mt-3 h-16 w-full" />)}
        </div>
      </Container>
    </div>
  );
}
