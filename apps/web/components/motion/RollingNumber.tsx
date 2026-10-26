'use client';

import { useLayoutEffect, useRef } from 'react';
import { cn } from '@apex/ui';
import { usePrefersReducedMotion } from './preferences';

/*
 * Rolling digits for numbers that change while you watch (countdown, live
 * gaps, position changes). Visual idea from motion-primitives' SlidingNumber
 * (https://motion-primitives.com, MIT, (c) 2024 ibelick).
 *
 * Performance: each digit is ONE strip of glyphs moved by a CSS transform
 * transition, so the roll runs on the compositor: no per-frame JavaScript, no
 * style writes, no repaint. (The previous framer-motion version drove ten
 * springs per digit from the main thread: about 370 style writes a second and
 * a repaint every frame for a ticking countdown.)
 *
 * The strip is [9,0,1,...,9,0]; a digit d sits at index d + 1. 9 -> 0 rolls
 * forward one step onto the trailing 0 and 0 -> 9 rolls back one step onto
 * the leading 9; after the roll the strip snaps (untransitioned) to the same
 * glyph at its home index. The real value is always in the DOM for assistive
 * tech; under reduced motion the digits are plain text.
 */

const STRIP = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const STEP = 100 / STRIP.length;
const EASE = 'transform 460ms cubic-bezier(0.22, 1, 0.36, 1)';
const at = (index: number) => `translateY(${-index * STEP}%)`;

function Digit({ digit }: { digit: number }) {
  const strip = useRef<HTMLSpanElement>(null);
  const previous = useRef(digit);

  useLayoutEffect(() => {
    const el = strip.current;
    const from = previous.current;
    previous.current = digit;
    if (!el || from === digit) return;
    const home = digit + 1;
    let target = home;
    if (from === 9 && digit === 0) target = 11; // forward onto the trailing 0
    else if (from === 0 && digit === 9) target = 0; // back onto the leading 9
    el.style.transition = EASE;
    el.style.transform = at(target);
    if (target === home) return;
    const settle = () => {
      el.style.transition = 'none';
      el.style.transform = at(home);
    };
    el.addEventListener('transitionend', settle, { once: true });
    return () => el.removeEventListener('transitionend', settle);
  }, [digit]);

  return (
    // The window hides the neighbouring digits of the roll by design (audits skip it via data-allow-clip).
    <span data-allow-clip className="relative inline-block h-[1em] w-[1ch] overflow-hidden leading-none">
      <span className="invisible">0</span>
      <span ref={strip} className="absolute inset-x-0 top-0 flex flex-col" style={{ transform: at(digit + 1) }}>
        {STRIP.map((d, i) => <span key={i} className="flex h-[1em] items-center justify-center">{d}</span>)}
      </span>
    </span>
  );
}

export function RollingNumber({ value, pad = 0, className }: { value: number; pad?: number; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const text = String(Math.max(0, Math.trunc(Math.abs(value)))).padStart(pad, '0');
  const sign = value < 0 ? '-' : '';
  if (reduced) return <span className={cn('tabular-nums', className)}>{sign + text}</span>;
  return (
    <span className={cn('inline-flex tabular-nums', className)}>
      <span className="sr-only">{sign + text}</span>
      <span aria-hidden className="inline-flex">
        {sign}
        {text.split('').map((c, i) => <Digit key={text.length - i} digit={Number(c)} />)}
      </span>
    </span>
  );
}
