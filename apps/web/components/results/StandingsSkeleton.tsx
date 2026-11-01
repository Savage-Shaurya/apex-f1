import '@/components/brand-c/brand-c.css';
import { Skeleton, SkeletonText, LightLoader } from '@/components/ds';

/**
 * Loading shape of a results page (RES-1, RES-2), drawn in the page's own
 * night layout: the same hero (breadcrumb, label, two-line title, story
 * lines, the championship switch and the leader card on the right), the
 * season row, the four-column stats strip and the dark board. Same blocks,
 * same heights, so the real page replaces it without a light flash or a
 * layout shift.
 */
export function StandingsSkeleton({ message = 'Loading the championship table' }: { message?: string }) {
  return (
    <div className="bc relative" aria-busy="true" data-skeleton="standings">
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="bc-carbon absolute inset-0 opacity-70" />
        <div aria-hidden className="bc-flood-static absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[color:var(--bc-night)] to-transparent" />
        <div className="ds-container relative pb-12 pt-6 md:pb-16 md:pt-10">
          <Skeleton className="h-5 w-56" />
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-10 md:mt-10 lg:grid-cols-12 lg:items-end lg:gap-8">
            <div className="min-w-0 lg:col-span-7">
              <Skeleton className="h-4 w-72 max-w-full" />
              <div className="mt-5 text-[clamp(2.1rem,5.6vw,4.6rem)] leading-[0.95]">
                <Skeleton className="h-[0.9em] w-[3.2em]" />
                <Skeleton className="mt-[0.12em] h-[0.56em] w-[min(100%,9em)]" />
              </div>
              <SkeletonText lines={2} className="mt-6 max-w-[54ch] text-[1.05rem] md:text-[1.12rem]" />
              <Skeleton className="mt-8 h-[52px] w-[15.5rem] rounded-full" />
            </div>
            <div className="min-w-0 lg:col-span-5">
              <div className="relative overflow-hidden rounded-[22px] bg-[color:var(--bc-carbon)] p-5 ring-1 ring-[color:var(--bc-rule)] sm:p-6">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="mt-4 h-[clamp(2rem,3.4vw,2.6rem)] w-3/4" />
                <Skeleton className="mt-3 h-4 w-1/2" />
                <div className="mt-6 flex items-end gap-6 border-t border-[color:var(--bc-rule)] pt-4">
                  <Skeleton className="h-[clamp(2rem,3.4vw,2.8rem)] w-24" />
                  <Skeleton className="h-[clamp(1.4rem,2.2vw,1.8rem)] w-12" />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-10 flex flex-col gap-4 border-t border-[color:var(--bc-rule)] pt-6 md:flex-row md:items-center md:justify-between">
            <Skeleton className="h-11 w-[min(100%,22rem)] rounded-full" />
            <LightLoader message={message} />
          </div>
        </div>
      </section>
      <section aria-hidden className="relative border-y border-[color:var(--bc-rule)] bg-[color:var(--bc-night)]">
        <div className="ds-container grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} data-stat-cell className="min-w-0 py-5 pr-4 lg:py-6">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-[clamp(1.6rem,2.6vw,2.2rem)] w-20" />
              <Skeleton className="mt-2 h-3.5 w-28" />
            </div>
          ))}
        </div>
      </section>
      <section aria-hidden className="relative bg-[color:var(--bc-night)] py-12 md:py-16 lg:py-20">
        <div className="ds-container">
          <Skeleton className="h-10 w-64" />
          <div className="mt-8 space-y-px">
            {Array.from({ length: 20 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        </div>
      </section>
    </div>
  );
}
