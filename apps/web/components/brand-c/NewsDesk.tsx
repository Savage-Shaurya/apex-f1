'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { AnimatePresence, m, useReducedMotion } from 'framer-motion';
import { cn } from '@apex/ui';
import { SmartImage } from '@/components/shell/SmartImage';
import { RelativeTime } from '@/components/news/RelativeTime';
import { HERO_SLIDE_MS, autoAdvances, stepSlide, type HeroSlide } from './news-hero';

const pad = (n: number) => String(n).padStart(2, '0');
const EASE = [0.22, 1, 0.36, 1] as const;
const noSubscribe = () => () => {};

/**
 * The home hero's rotating news desk: the newest real Formula 1 stories,
 * each on the publisher's own picture, crossfading every six seconds.
 *
 * - The first story is in the server HTML (its picture is the LCP, eager and
 *   high priority); the next picture loads quietly behind it after hydration.
 * - The active story's thin timer bar fills on the compositor and its end
 *   advances the slide (no JavaScript interval). It pauses on hover, on
 *   keyboard focus, off-screen and from its own button (WCAG 2.2.2).
 * - Reduced motion: no timer, no zoom, no auto-advance; the controls still work.
 * - Every story links out to the publisher's article, like /latest.
 */
export function NewsDesk({ slides }: { slides: HeroSlide[] }) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  // False in the server HTML and during hydration, true after: the next picture never competes with the LCP.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [failed, setFailed] = useState<ReadonlySet<number>>(() => new Set());
  const reducedMotion = useReducedMotion() ?? false;
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const paused = hovered || focused || userPaused || !onScreen;
  const running = autoAdvances({ reducedMotion, paused, count });
  const timed = !reducedMotion && count > 1;
  const go = useCallback((to: number) => setIndex(((to % count) + count) % count), [count]);
  const step = useCallback((by: 1 | -1) => setIndex((i) => stepSlide(i, by, count)), [count]);
  const markFailed = useCallback((i: number) => setFailed((prev) => (prev.has(i) ? prev : new Set(prev).add(i))), []);

  const slide = slides[index]!;
  const next = stepSlide(index, 1, count);

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-labelledby="bc-hero-title"
      className="relative grid grid-cols-[minmax(0,1fr)] lg:min-h-[clamp(560px,calc(100svh-var(--shell-h,64px)-7.5rem),800px)]"
      // A mouse resting on the desk pauses it; a tap on a touch screen must not leave it paused.
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHovered(false); }}
      onFocus={(e) => setFocused((e.target as HTMLElement).matches(':focus-visible'))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      {/* Picture: a full-width 16:9 frame on phones and tablets (the whole photograph, no side crop);
          from lg it fills the hero behind the words. */}
      <div aria-hidden className="relative aspect-[16/9] overflow-hidden bg-[color:var(--bc-carbon)] lg:col-start-1 lg:row-start-1 lg:aspect-auto">
        <AnimatePresence initial={false} mode="sync">
          <m.div
            key={index}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 1.1, ease: EASE }}
          >
            {!failed.has(index) && (
              <div className="bc-desk-kb absolute inset-0">
                <SmartImage
                  src={slide.image}
                  alt=""
                  eager={index === 0}
                  sizes="100vw"
                  fit="cover"
                  focal="50% 30%"
                  className="absolute inset-0"
                  onFail={() => markFailed(index)}
                />
              </div>
            )}
          </m.div>
        </AnimatePresence>
        {/* The next picture loads behind the current one, so the crossfade never waits on the network. */}
        {hydrated && count > 1 && !failed.has(next) && (
          <div key={`pre-${next}`} className="pointer-events-none absolute inset-0 opacity-0">
            <SmartImage src={slides[next]!.image} alt="" sizes="100vw" fit="cover" focal="50% 30%" className="absolute inset-0" onFail={() => markFailed(next)} />
          </div>
        )}
        {/* Scrims keep every word at AA on any photograph: a floor fade below lg, a left and floor wash from lg. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(5_5_6/0.25)_0%,transparent_28%,transparent_62%,var(--bc-night)_100%)] lg:bg-[linear-gradient(90deg,rgb(5_5_6/0.92)_0%,rgb(5_5_6/0.72)_34%,rgb(5_5_6/0.18)_66%,rgb(5_5_6/0.05)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[55%] bg-[linear-gradient(0deg,var(--bc-night)_0%,rgb(5_5_6/0.82)_32%,transparent_100%)] lg:block" />
      </div>

      <div className="ds-container relative z-[2] flex min-w-0 flex-col justify-end pb-8 pt-2 lg:col-start-1 lg:row-start-1 lg:pb-12 lg:pt-28">
        <div className="max-w-[44rem]">
          <h1 id="bc-hero-title" className="bc-label flex flex-wrap items-center gap-x-3 gap-y-1 text-[color:var(--bc-silver)]">
            <span aria-hidden className="h-[2px] w-8 bg-[color:var(--bc-red)]" />
            <span>Latest Formula 1 news</span>
          </h1>

          <div aria-live={running ? 'off' : 'polite'} aria-atomic="true">
            <AnimatePresence initial={false} mode="wait">
              <m.article
                key={index}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: reducedMotion ? 0 : 0.45, ease: EASE }}
                className="group/story mt-4"
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.86rem] text-[color:var(--bc-silver)]">
                  <span className="font-semibold text-[color:var(--bc-white)]">{slide.source}</span>
                  <span aria-hidden className="text-[color:var(--bc-titanium)]">·</span>
                  <RelativeTime ms={slide.publishedMs} />
                </p>
                <h2 className="mt-3 text-[clamp(1.6rem,1.05rem+2.3vw,3.25rem)] font-semibold leading-[1.1] text-[color:var(--bc-white)] [text-wrap:balance]">
                  <a
                    href={slide.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="decoration-[color:var(--bc-red)] decoration-2 underline-offset-[0.16em] hover:underline focus-visible:underline"
                  >
                    {slide.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </h2>
                {slide.standfirst && (
                  <p className="mt-4 max-w-[56ch] text-[1rem] leading-relaxed text-[color:var(--bc-silver)] [text-wrap:pretty] lg:text-[1.08rem]">{slide.standfirst}</p>
                )}
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <a
                    href={slide.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[color:var(--bc-white)] px-5 text-[0.9rem] font-semibold text-[color:var(--bc-night)] transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-0.5 hover:bg-white motion-reduce:transform-none"
                  >
                    Read at {slide.source} <span aria-hidden>↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <Link
                    href="/latest"
                    className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[0.9rem] font-medium text-[color:var(--bc-white)] ring-1 ring-white/30 transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-white/[0.04] hover:ring-white/60 motion-reduce:transform-none"
                  >
                    All F1 news <span aria-hidden>→</span>
                  </Link>
                </div>
              </m.article>
            </AnimatePresence>
          </div>
        </div>

        {count > 1 && (
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* One thin timer bar per story; each is a button that shows that story. */}
            <ol className="flex min-w-0 flex-[1_1_16rem] items-center gap-1.5" aria-label="Stories">
              {slides.map((s, i) => (
                <li key={s.href} className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-label={`Story ${i + 1} of ${count}: ${s.title}`}
                    aria-current={i === index ? 'true' : undefined}
                    className="group/bar flex h-11 w-full items-center"
                  >
                    <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/20 transition-colors group-hover/bar:bg-white/35">
                      {i < index && <span className="absolute inset-0 bg-white/70" />}
                      {i === index && (
                        <span
                          key={`fill-${index}`}
                          className="bc-desk-fill absolute inset-0 bg-[color:var(--bc-red)]"
                          data-run={timed ? '' : undefined}
                          style={{ '--desk-ms': `${HERO_SLIDE_MS}ms`, animationPlayState: running ? 'running' : 'paused' } as CSSProperties}
                          onAnimationEnd={() => { if (running) step(1); }}
                        />
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-1">
              <span className="bc-mono mr-2 text-[0.82rem] text-[color:var(--bc-silver)]" aria-hidden>
                {pad(index + 1)} / {pad(count)}
              </span>
              <DeskButton label="Previous story" onClick={() => step(-1)}>
                <path d="M15 6l-6 6 6 6" />
              </DeskButton>
              {!reducedMotion && (
                <DeskButton label={userPaused ? 'Play the rotation' : 'Pause the rotation'} pressed={userPaused} onClick={() => setUserPaused((p) => !p)}>
                  {userPaused ? <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" /> : <path d="M9 6v12M15 6v12" />}
                </DeskButton>
              )}
              <DeskButton label="Next story" onClick={() => step(1)}>
                <path d="M9 6l6 6-6 6" />
              </DeskButton>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DeskButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'grid size-11 place-items-center rounded-full text-[color:var(--bc-white)] ring-1 ring-white/25 transition-[background-color,box-shadow] duration-200 hover:bg-white/[0.06] hover:ring-white/55',
        pressed && 'bg-white/[0.08] ring-white/55',
      )}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
