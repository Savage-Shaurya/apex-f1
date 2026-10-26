import type { ReactNode } from 'react';
import { SplitReveal } from '@/components/fx/SplitReveal';
import { SectionHeader } from '@/components/ui';
import { SideIndex, type IndexItem } from './SideIndex';

export interface Fact {
  label: string;
  value: ReactNode;
}

/**
 * Editorial page opener: mono eyebrow, a giant masked display title, an
 * EB Garamond lede and a hairline fact block.
 */
export function InfoHero({
  eyebrow,
  kicker,
  title,
  lede,
  facts,
  size = 'giant',
  children,
}: {
  eyebrow: string;
  kicker?: string;
  title: ReactNode;
  lede: ReactNode;
  facts?: Fact[];
  size?: 'mega' | 'giant';
  children?: ReactNode;
}) {
  return (
    <header className="relative overflow-hidden border-b border-white/[0.07]">
      <div aria-hidden className="timing-rules pointer-events-none absolute inset-0 opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="apex-container relative pb-12 pt-14 md:pb-16 md:pt-20">
        <div className="flex items-center gap-3 font-data text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">
          <span className="text-telemetry-red">{eyebrow}</span>
          {kicker && <span aria-hidden className="h-px w-8 bg-white/20" />}
          {kicker && <span>{kicker}</span>}
        </div>
        <SplitReveal
          as="h1"
          className={`mt-6 text-balance font-display font-extrabold uppercase text-on-background ${size === 'mega' ? 'text-mega' : 'text-giant'}`}
        >
          {title}
        </SplitReveal>
        <div className="mt-10 grid gap-10 md:mt-14 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="max-w-[40ch] font-editorial text-[clamp(1.3rem,1.9vw,1.85rem)] leading-[1.38] text-on-background/90">{lede}</div>
            {children}
          </div>
          {facts && facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-px self-end border border-white/[0.08] bg-white/[0.08] lg:col-span-5">
              {facts.map((f) => (
                <div key={f.label} className="bg-background px-5 py-5">
                  <dt className="font-data text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">{f.label}</dt>
                  <dd className="mt-2 font-display text-[clamp(1.4rem,2.2vw,2rem)] font-extrabold uppercase leading-none tracking-[-0.02em] text-on-background">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </header>
  );
}

/** 12-column body with a sticky side index on desktop. */
export function InfoBody({ index, children }: { index: IndexItem[]; children: ReactNode }) {
  return (
    <div className="apex-container grid gap-x-10 lg:grid-cols-12">
      <div className="hidden pt-16 md:pt-20 lg:col-span-3 lg:block">
        <SideIndex items={index} />
      </div>
      <div className="min-w-0 lg:col-span-9">{children}</div>
    </div>
  );
}

/** One numbered editorial section. */
export function InfoSection({
  id,
  index,
  eyebrow,
  title,
  children,
  last = false,
}: {
  id: string;
  index: string;
  eyebrow?: string;
  title: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-28 py-16 md:py-20 ${last ? '' : 'border-b border-white/[0.07]'}`}>
      <SectionHeader id={`${id}-title`} index={index} eyebrow={eyebrow} title={title} size="title" />
      <div className="mt-10">{children}</div>
    </section>
  );
}
