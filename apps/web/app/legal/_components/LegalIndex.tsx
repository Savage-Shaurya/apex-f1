'use client';

import { useEffect, useState } from 'react';
import { cn } from '@apex/ui';

/**
 * "On this page" for legal documents. Desktop: a sticky list that marks the
 * section in view (IntersectionObserver, no scroll loop). Phones: a native
 * disclosure at the top, closed by default.
 */
export function LegalIndex({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length || typeof IntersectionObserver === 'undefined') return;
    // The observer is only a cheap trigger; the active item is always the last
    // section whose top has passed 30% of the viewport (correct in both directions).
    const pick = () => {
      const line = window.innerHeight * 0.3;
      let current = sections[0]!.id;
      for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s.id;
      setActive(current);
    };
    const io = new IntersectionObserver(pick, { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] });
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  const list = (
    <ol className="shadow-[inset_1px_0_0_var(--rule)]">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={item.id === active ? 'location' : undefined}
            className={cn(
              'flex min-h-11 items-center py-1.5 pl-4 font-text text-small transition-colors duration-[var(--duration-fast)]',
              item.id === active ? 'text-fg shadow-[inset_2px_0_0_var(--color-brand-red)]' : 'text-fg-2 hover:text-fg',
            )}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <details className="group lg:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-text text-ui font-[650] text-fg shadow-[inset_0_-1px_0_var(--rule)] [&::-webkit-details-marker]:hidden">
          On this page
          <span aria-hidden className="text-fg-3 transition-transform group-open:rotate-180">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m5 9 7 7 7-7" /></svg>
          </span>
        </summary>
        <nav aria-label="On this page" className="pt-4">{list}</nav>
      </details>
      <nav aria-label="On this page" className="sticky top-[calc(var(--nav-offset)+2rem)] hidden transition-[top] duration-[var(--duration-slow)] lg:block">
        <p className="mb-4 font-text text-label uppercase text-fg-3">On this page</p>
        {list}
      </nav>
    </>
  );
}
