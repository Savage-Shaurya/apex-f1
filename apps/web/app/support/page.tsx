import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@apex/ui';
import '@/components/brand-c/brand-c.css';
import '@/components/info/carbon-light.css';
import { fitDisplay } from '@/components/info/carbon';
import { KindLight } from '@/components/brand-c/stages';
import { Icon } from '@/components/ds';
import { socialLink } from '@/components/ds/shell/social';
import { Rise } from './_components/Rise';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'Give back: every life deserves a pit crew',
  description:
    'Apex is free, with no ads and no tip jar. If it ever brightened your race weekend, the only thing it asks is one small kindness for an animal near you: put out water, feed a stray, back a shelter, help an injured animal, adopt.',
  alternates: { canonical: '/support' },
});

const CREATOR_INSTAGRAM = socialLink('instagram').href;
const CREATOR_X = socialLink('x').href;
const CREATOR_LINKEDIN = socialLink('linkedin').href;

/** Map searches around wherever the reader is: they work in any country and favour no organisation. */
const MAPS = 'https://www.google.com/maps/search/';

interface KindAct {
  title: string;
  body: string;
  links: Array<{ label: string; href: string }>;
}

/** Small kindnesses. None needs money; the links search around wherever the reader is. */
const ACTS: readonly KindAct[] = [
  {
    title: 'Put out water',
    body: 'A bowl of clean water by your door on a hot day. For a street dog or cat, it may be the only drink they find all afternoon.',
    links: [],
  },
  {
    title: 'Feed a stray',
    body: 'A handful of food, offered gently. It is the smallest thing, and it can turn a street animal’s whole day around.',
    links: [],
  },
  {
    title: 'Back a shelter',
    body: 'Give an hour, foster, or donate to a local shelter or rescue. Old blankets and an afternoon of your time mean more than money.',
    links: [{ label: 'Shelters near you', href: `${MAPS}animal+shelter+near+me` }],
  },
  {
    title: 'Help one that is hurt',
    body: 'Call a local rescue or take the animal to a vet, and stay with it if you can. Minutes matter more than money.',
    links: [
      { label: 'Vets near you', href: `${MAPS}veterinarian+near+me` },
      { label: 'Rescues near you', href: `${MAPS}animal+rescue+near+me` },
    ],
  },
  {
    title: 'Adopt, don’t buy',
    body: 'When you are ready for a companion, adopt from a shelter. One adoption is one whole life saved, and it frees a place for the next animal who needs it.',
    links: [],
  },
];

const NEVER = [
  'Team or constructor sponsorships',
  'FOM or FIA licensing money',
  'Behavioural ads or tracker revenue',
  'Subscriptions for things that should be free',
];

/** CSS entrance delay for the first-paint choreography (brand-c.css: bc-in-rise / bc-in-up). */
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/** An outbound link that says it opens a new tab, for sighted and screen-reader readers alike. */
function OutLink({ href, className, rel, children }: { href: string; className: string; rel?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel={rel ?? 'noopener noreferrer'} className={className}>
      <span>{children}</span>
      <span className="sr-only"> (opens in a new tab)</span>
      <Icon name="arrow-up-right" size={18} className="shrink-0" />
    </a>
  );
}

/**
 * Give back. The owner's own page and words: the one ask Apex will ever make
 * is a kindness to an animal. Carbon & Light: night, carbon and one warm
 * light rising from below. No photographs; type and light carry it.
 */
export default function SupportPage() {
  return (
    <article className="bc bcp relative overflow-x-clip [&_a]:scroll-mt-28">
      {/* Opening: the warm light rises behind the words. */}
      <section aria-labelledby="give-title" className="relative isolate overflow-hidden">
        <KindLight className="pointer-events-none absolute inset-0 -z-10 [&>div]:absolute [&>div]:inset-0" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-[color:var(--bc-night)] to-transparent" />
        <div className="ds-container pb-40 pt-14 text-center sm:pb-48 sm:pt-20 lg:pb-56 lg:pt-24">
          <p className="bc-label bc-in-up text-[color:var(--bc-silver)]" style={delay(0)}>Give back</p>
          <h1 id="give-title" className="mt-7 text-balance text-white">
            <span className="bc-mask bcp-fit" style={fitDisplay('Every life deserves', { max: 7 })}>
              <span className="bc-display bc-in-rise" style={delay(80)}>Every life deserves</span>
            </span>{' '}
            <span className="bc-mask bcp-mask-serif text-[clamp(3rem,1.6rem+7.2vw,8.5rem)] leading-[1.02]">
              <span className="bc-serif bc-in-rise mt-1" style={delay(220)}>a pit crew.</span>
            </span>
          </h1>
          <p className="bc-in-up mx-auto mt-9 max-w-[54ch] text-pretty text-[clamp(1.075rem,0.98rem+0.45vw,1.3rem)] leading-[1.6] text-[color:var(--bc-white)]" style={delay(480)}>
            Apex has never asked you for anything. It is made and paid for by one person, with no ads, no paywall, no team money
            and no tip jar. But if a result, the championship archive or a driver’s story ever brightened your day, I would love
            you to pass that feeling on to an animal near you, one who cannot ask for help. Then tell me about it. I genuinely
            want to see it.
          </p>
          <p className="bc-in-up mx-auto mt-6 max-w-[48ch] text-pretty text-[0.975rem] leading-[1.6] text-[color:var(--bc-silver)]" style={delay(600)}>
            I’m an animal lover before I’m anything else. Of everything on Apex, this page is the closest to my heart, so it lives
            in the main navigation, right beside the racing.
          </p>
        </div>
      </section>

      {/* Pick one */}
      <section aria-labelledby="acts-title" className="bc-carbon relative border-t border-[color:var(--bc-rule)] py-20 sm:py-24 lg:py-32">
        <div className="ds-container grid gap-y-14 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-5">
            <div className="@container lg:sticky lg:top-[calc(var(--nav-offset,0px)+3rem)]">
              <p className="bc-label text-[color:var(--bc-red-text)]">Choose any one</p>
              {/* Sized by the column too, so KINDNESS never breaks mid-word. */}
              <h2 id="acts-title" className="bc-display mt-5 max-w-[12ch] text-[clamp(2rem,min(1.3rem+4vw,13cqi),4.5rem)] text-white">
                Kindness that costs nothing
              </h2>
              <p className="mt-7 max-w-[40ch] text-pretty text-[1.125rem] leading-[1.6] text-[color:var(--bc-silver)]">
                Here is a start you can make today. Any one of these is enough, and none of them needs money.
              </p>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-7">
            <ul className="border-b border-[color:var(--bc-rule)]">
              {ACTS.map((act) => (
                <li
                  key={act.title}
                  className={cn(
                    'group relative isolate border-t border-[color:var(--bc-rule-strong)] py-9 sm:py-11',
                    // Warm light gathers under the act you are reading (opacity only).
                    'before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:-z-10 before:h-full before:bg-[radial-gradient(ellipse_70%_90%_at_18%_100%,rgb(255_143_122/0.10),transparent_70%)] before:opacity-0 before:transition-opacity before:duration-700 before:ease-[var(--bc-ease)] hover:before:opacity-100 focus-within:before:opacity-100 motion-reduce:before:transition-none',
                  )}
                >
                  <h3 className="bc-wide text-[clamp(1.5rem,1.1rem+1.9vw,2.6rem)] leading-[1.05] text-white">{act.title}</h3>
                  <p className="mt-4 max-w-[50ch] text-pretty text-[1.0625rem] leading-[1.65] text-[color:var(--bc-silver)]">{act.body}</p>
                  {act.links.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-1">
                      {act.links.map((l) => (
                        <li key={l.href}>
                          <OutLink
                            href={l.href}
                            className="inline-flex min-h-11 items-center gap-2 text-[0.975rem] font-semibold text-[color:var(--bc-red-text)] underline decoration-transparent decoration-2 underline-offset-[6px] transition-[text-decoration-color] duration-300 hover:decoration-current focus-visible:decoration-current"
                          >
                            {l.label}
                          </OutLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            <p className="bc-serif mt-14 text-[clamp(2.25rem,1.5rem+3vw,4rem)] leading-[1.08] text-white">
              Now go and do one.
            </p>
            <p className="mt-10 max-w-[60ch] text-[0.9375rem] leading-[1.6] text-[color:var(--bc-titanium)]">
              These links open Google Maps around wherever you are, in any country. Apex has no tie to any shelter, vet or rescue,
              or to Google, and gains nothing from them.
            </p>
          </div>
        </div>
      </section>

      {/* The heart of it, set large */}
      <section aria-label="From the maker" className="relative isolate overflow-hidden border-t border-[color:var(--bc-rule)] py-24 sm:py-28 lg:py-40">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_50%_60%_at_50%_110%,rgb(255_120_100/0.12),rgb(225_6_0/0.05)_45%,transparent_75%)]" />
        <Rise as="figure" className="ds-container mx-auto max-w-[72rem] text-center">
          <blockquote>
            <p className="bc-serif text-balance text-[clamp(1.875rem,1.1rem+3.4vw,4.25rem)] leading-[1.14] text-white">
              The best currency this site could ever earn isn’t money in an account.
            </p>
            <p className="bc-serif mt-4 text-balance text-[clamp(1.875rem,1.1rem+3.4vw,4.25rem)] leading-[1.14] text-[color:var(--bc-silver)]">
              It’s a stray that got fed, a shelter that got an hour, a life that got rescued.
            </p>
          </blockquote>
          <figcaption className="bc-label mt-10 text-[color:var(--bc-silver)]">Shaurya Punj, who makes Apex</figcaption>
        </Rise>
      </section>

      {/* The one ask */}
      <section aria-labelledby="tag-title" className="relative isolate overflow-hidden bg-[color:var(--bc-red)] py-20 text-white sm:py-24 lg:py-28">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(255_255_255/0.07),transparent_45%,rgb(0_0_0/0.16))]" />
        <div className="ds-container grid items-end gap-y-10 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-7">
            <h2 id="tag-title" className="bc-display max-w-[14ch] text-[clamp(2.25rem,1.3rem+4vw,4.5rem)]">Then tell me about it</h2>
            <p className="mt-7 max-w-[42ch] text-pretty text-[1.125rem] leading-[1.6]">
              Share the stray you fed or the shelter you helped, and tag me. It genuinely makes my week, and it may be the gentle
              nudge the next person needs.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap lg:col-span-5 lg:justify-end">
            <OutLink
              href={CREATOR_INSTAGRAM}
              rel="noopener noreferrer me"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-[0.975rem] font-semibold text-[color:var(--bc-night)] transition-colors hover:bg-[color:var(--bc-silver)]"
            >
              Tag me on Instagram
            </OutLink>
            <OutLink
              href={CREATOR_X}
              rel="noopener noreferrer me"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-7 text-[0.975rem] font-semibold text-white shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.85)] transition-colors hover:bg-white/10"
            >
              Tag me on X
            </OutLink>
            <OutLink
              href={CREATOR_LINKEDIN}
              rel="noopener noreferrer me"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-7 text-[0.975rem] font-semibold text-white shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.85)] transition-colors hover:bg-white/10"
            >
              Tag me on LinkedIn
            </OutLink>
          </div>
        </div>
      </section>

      {/* The deal */}
      <section aria-labelledby="deal-title" className="py-20 sm:py-24 lg:py-32">
        <div className="ds-container grid gap-y-12 lg:grid-cols-12 lg:gap-x-10">
          <div className="min-w-0 lg:col-span-6">
            <h2 id="deal-title" className="bc-display text-[clamp(2rem,1.3rem+3vw,3.5rem)] text-white">Why there is no price</h2>
            <p className="mt-7 max-w-[46ch] text-pretty text-[clamp(1.125rem,1rem+0.5vw,1.375rem)] leading-[1.6] text-[color:var(--bc-white)]">
              Apex is made with a lot of late nights and a great deal of love. It does not need your money to keep going. What
              would mean far more is a world that is a little kinder than it was yesterday. That is a trade I will happily make,
              every single time.
            </p>
          </div>
          <div className="min-w-0 lg:col-span-5 lg:col-start-8">
            <h3 className="bc-label text-[color:var(--bc-silver)]">What Apex will never take</h3>
            <ul className="mt-5 border-t border-[color:var(--bc-rule-strong)]">
              {NEVER.map((item) => (
                <li key={item} className="flex min-h-14 items-center gap-4 border-b border-[color:var(--bc-rule)] py-3 text-[1rem] text-white">
                  <Icon name="close" size={18} className="shrink-0 text-[color:var(--bc-red-text)]" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="ds-container">
          <p className="mt-16 max-w-[60ch] text-[1rem] leading-[1.6] text-[color:var(--bc-silver)]">
            Just here for the racing? You are so welcome. Explore the{' '}
            <Link href="/results/archive" className="font-semibold text-white underline decoration-[color:var(--bc-red-text)] decoration-2 underline-offset-4 hover:decoration-white">
              championship archive
            </Link>{' '}
            or meet the{' '}
            <Link href="/about" className="font-semibold text-white underline decoration-[color:var(--bc-red-text)] decoration-2 underline-offset-4 hover:decoration-white">
              person behind Apex
            </Link>
            .
          </p>
        </div>
      </section>
    </article>
  );
}
