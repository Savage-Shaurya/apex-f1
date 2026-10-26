import { Section, Skeleton, SkeletonText, LightLoader } from '@/components/ds';

/**
 * Loading shapes for the racing-data routes (blueprint 13): the title bar and
 * the real row count of each layout, so nothing jumps when data arrives.
 */
export function RouteSkeleton({ variant, message }: { variant: 'calendar' | 'weekend' | 'standings' | 'archive'; message: string }) {
  const rows = variant === 'calendar' ? 24 : variant === 'archive' ? 12 : 20;
  return (
    <div aria-busy="true">
      <Section tone="carbon" spacing="none" className="pb-[var(--space-block)] pt-6 md:pt-10">
        <Skeleton className="h-5 w-48" />
        <Skeleton className={variant === 'weekend' ? 'mt-10 h-[clamp(2.25rem,9vw,10rem)] w-[min(100%,52rem)]' : 'mt-10 h-[clamp(2rem,5.4vw,6.5rem)] w-[min(100%,40rem)]'} />
        <SkeletonText lines={2} className="mt-6 max-w-xl" />
        {variant === 'weekend' && (
          <div className="mt-12 grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5"><SkeletonText lines={5} /></div>
            <Skeleton className="aspect-[4/3] w-full lg:col-span-7 lg:aspect-[16/10]" />
          </div>
        )}
        {variant === 'archive' && <Skeleton className="mt-12 h-44 w-full sm:h-56" />}
        <LightLoader className="mt-10" message={message} />
      </Section>
      <Section tone="paper" spacing="tight">
        <Skeleton className="h-10 w-64" />
        <div className="mt-8 max-w-[60rem] space-y-px">
          {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      </Section>
    </div>
  );
}
