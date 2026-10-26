import { Container, Skeleton, SkeletonText } from '@/components/ds';

/** Breadcrumb, headline, standfirst and the 16:9 picture, while publication and embargo are checked (audit PERF2-3). */
export default function ArticleLoading() {
  return (
    <div className="tone-carbon" aria-busy="true">
      <Container className="pb-[var(--space-section)] pt-[clamp(2rem,4.5vw,4rem)]">
        <Skeleton className="h-5 w-48" label="Loading the story" />
        <div className="mt-10 max-w-[56rem]">
          <SkeletonText lines={2} className="text-display-m" />
          <SkeletonText lines={2} className="mt-6 max-w-[40rem] text-lead" />
        </div>
        <Skeleton className="mt-10 aspect-video w-full max-w-[72rem]" />
      </Container>
    </div>
  );
}
