import { Container, Grid, Skeleton, SkeletonText } from '@/components/ds';

/**
 * Loading shape for the news and video pages: the title bar, the filter row,
 * one 16:9 lead frame and the rail of rows beside it (ds 13 "Loading shape").
 */
export function StreamSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div className="tone-carbon" aria-busy="true">
      <Container className="pb-10 pt-[clamp(2.5rem,6vw,5rem)] md:pb-14">
        <Skeleton className="h-[clamp(2.25rem,0.6rem+9vw,10rem)] w-[min(100%,40rem)]" label={label} />
        <Skeleton className="mt-6 h-7 w-[min(100%,32rem)]" />
      </Container>
      <Container>
        <Skeleton className="h-14 w-full" />
        <Grid className="mt-10 gap-y-10 md:mt-14">
          <div className="col-span-4 md:col-span-8 lg:col-span-8">
            <Skeleton className="aspect-video w-full" />
            <SkeletonText lines={3} className="mt-5 max-w-[36rem] text-heading-l" />
          </div>
          <div className="col-span-4 flex flex-col gap-6 md:col-span-8 lg:col-span-4">
            {Array.from({ length: rows }, (_, i) => <SkeletonText key={i} lines={2} className="text-body" />)}
          </div>
        </Grid>
      </Container>
    </div>
  );
}
