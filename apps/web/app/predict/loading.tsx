import { Container, Skeleton, LightLoader } from '@/components/ds';

export default function Loading() {
  return (
    <div className="tone-carbon">
      <Container className="py-[var(--space-section)]">
        <LightLoader message="Loading the grid and the next race" />
        <Skeleton className="mt-8 h-[clamp(2rem,6vw,6rem)] w-[min(30rem,80%)]" />
        <div className="mt-16 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[3/4]" />)}
        </div>
      </Container>
    </div>
  );
}
