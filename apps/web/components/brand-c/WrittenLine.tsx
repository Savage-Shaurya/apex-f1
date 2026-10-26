'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@apex/ui';

/**
 * The championship line, written from the published points. Content renders
 * in place and is never hidden: the first time it is seen (and whenever the
 * data rewrites it) each letter flashes timing-red in turn, like a timing
 * board writing. Colour only, so nothing moves or reflows. Off under reduced motion.
 */
export function WrittenLine({ text, as: Tag = 'h2', id, className }: { text: string; as?: 'h1' | 'h2' | 'p'; id?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setWriting(true); io.disconnect(); } }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [text]);
  const words = text.split(' ');
  let n = 0;
  return (
    <Tag key={text} ref={ref as never} id={id} aria-label={text} className={cn(className)} data-writing={writing || undefined}>
      {words.map((w, wi) => (
        <span key={wi} aria-hidden className="inline-block whitespace-nowrap">
          {Array.from(w).map((c, ci) => {
            const i = n++;
            return (
              <span key={ci} className={cn('bc-ch', writing && 'bc-ch--on')} style={{ '--i': i } as CSSProperties}>{c}</span>
            );
          })}
          {wi < words.length - 1 ? ' ' : null}
        </span>
      ))}
    </Tag>
  );
}
