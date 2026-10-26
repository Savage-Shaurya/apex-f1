import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import { Container, Skeleton, LightLoader } from '@/components/ds';

/** Loading shape of a /live screen: sub-bar, title block, weekend row and the sheet's rows. */
export function SheetLoading({ message }: { message: string }) {
  return (
    <div className="bc bcp">
      <div className="h-[3.25rem] border-b border-[color:var(--bc-rule)] bg-[#070709]" />
      <Container className="py-10 md:py-16">
        <LightLoader message={message} />
        <Skeleton className="mt-8 h-[clamp(2.25rem,6vw,6rem)] w-[min(36rem,80%)]" />
        <Skeleton className="mt-4 h-8 w-[min(24rem,60%)]" />
        <div className="mt-12 grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="mt-16 grid max-w-[64rem] gap-3">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      </Container>
    </div>
  );
}
