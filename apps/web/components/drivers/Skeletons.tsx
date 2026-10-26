import { Skeleton, SkeletonText, LightLoader } from '@/components/ds';

/**
 * Loading shapes for the People routes, in the exact layout of the final
 * page (DS 13: title bar, frames at their real aspect ratios, table rows),
 * so nothing shifts when the data arrives. Each names what is loading.
 */

function TitleBar({ message }: { message: string }) {
  return (
    <div className="ds-container pb-10 pt-10 md:pb-14 md:pt-16">
      <div className="ds-grid items-end gap-y-8">
        <div className="col-span-4 md:col-span-8 lg:col-span-7">
          <Skeleton className="h-[clamp(2rem,6vw,6rem)] w-3/4" />
          <SkeletonText lines={2} className="mt-6 max-w-[40ch]" />
        </div>
        <div className="col-span-4 md:col-span-8 lg:col-span-5">
          <LightLoader message={message} />
        </div>
      </div>
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div aria-busy="true">
      <TitleBar message="Loading the grid" />
      <div className="ds-container grid gap-x-6 gap-y-6 pb-24 md:grid-cols-2 md:gap-y-10 lg:gap-x-14">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className={`grid grid-cols-[5.75rem_1fr] gap-4 pt-3 sm:grid-cols-[7rem_1fr] sm:gap-5 lg:grid-cols-[8.5rem_1fr] lg:gap-6 ${i % 2 ? 'md:translate-y-[calc(50%+1.25rem)]' : ''}`}>
            <Skeleton className="aspect-square w-full" />
            <div className="flex flex-col justify-between py-1">
              <Skeleton className="h-10 w-12" />
              <SkeletonText lines={2} />
              <Skeleton className="h-7 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProfileSkeleton({ message = 'Loading the driver profile' }: { message?: string }) {
  return (
    <div aria-busy="true" className="ds-container pb-20 pt-8 md:pt-12">
      <div className="ds-grid items-end gap-y-8">
        <Skeleton className="col-span-4 aspect-[5/6] w-full max-w-[26rem] md:col-span-3 md:max-w-none lg:col-span-5" />
        <div className="col-span-4 md:col-span-5 lg:col-span-7">
          <LightLoader message={message} />
          <Skeleton className="mt-8 h-8 w-40" />
          <Skeleton className="mt-3 h-[clamp(3rem,9vw,9rem)] w-4/5" />
          <div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        </div>
      </div>
      <div className="mt-20 flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11 max-w-[60rem]" />)}
      </div>
    </div>
  );
}

export function TeamsSkeleton({ message = 'Loading the constructors' }: { message?: string }) {
  return (
    <div aria-busy="true">
      <TitleBar message={message} />
      <div className="flex flex-col gap-px">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="ds-container ds-grid items-center gap-y-6 py-12">
            <div className="col-span-4 md:col-span-8 lg:col-span-5">
              <Skeleton className="h-16 w-16" />
              <Skeleton className="mt-5 h-12 w-2/3" />
              <Skeleton className="mt-6 h-12 w-full" />
            </div>
            <Skeleton className="col-span-4 aspect-[1200/264] w-full md:col-span-8 lg:col-span-7" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DirectorySkeleton({ message }: { message: string }) {
  return (
    <div aria-busy="true">
      <TitleBar message={message} />
      <div className="ds-container pb-20">
        <Skeleton className="h-12 max-w-[40rem]" />
        <Skeleton className="mt-6 h-11 w-full" />
        <div className="mt-8 flex flex-col gap-2">
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      </div>
    </div>
  );
}

export function HallSkeleton() {
  return (
    <div aria-busy="true" className="ds-container pb-20">
      <LightLoader message="Loading the champions" />
      <div className="mt-10 grid grid-cols-2 items-end gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {[11, 11, 7.6, 6, 6, 6].map((h, i) => <span key={i} className="block" style={{ height: `${h}rem` }}><Skeleton className="h-full w-full" /></span>)}
      </div>
      <div className="mt-16 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-10 w-20" />
            <Skeleton className="mt-3 aspect-[4/5] w-full" />
            <SkeletonText lines={2} className="mt-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
